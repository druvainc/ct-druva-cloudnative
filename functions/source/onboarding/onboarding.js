/**
 * This function will be executed when first running the template in the management account or for cleaning up the installation in the management account
 * @param {*} event
 * @param {*} context
 * @returns
 */
exports.handler = async (event, context) => {
	const responder = require('cfn-custom-resource');
	console.log('Received event', JSON.stringify(event, null, 4));

	try {
		if (['Create', 'Update'].includes(event.RequestType)) {
			await createOrUpdateStackSet(context);
		} else if (['Delete'].includes(event.RequestType)) {
			await deleteStackSet(context);
		}

		return responder.sendResponse({
			Status: 'SUCCESS',
			PhysicalResourceId: event.PhysicalResourceId || context.logStreamName,
		}, event)

	} catch (e) {
		console.log('8')
		console.log('Onboarding function has encountered an error', JSON.stringify(e, null, 4));

		return responder.sendResponse({
			Status: 'SUCCESS',
			Reason: "See the details in CloudWatch Log Stream: " + context.logStreamName,
			PhysicalResourceId: event.PhysicalResourceId || context.logStreamName,
		}, event)
	}
}

/**
 * This function will perform the following actions:
 * 1. Create the stack set in the management account if necessary
 * 2. Create a stack set for each target account provided
 * @param  {} context
 */
async function createOrUpdateStackSet(context) {
	const {
		stackSNS,
		stackRegion,
		stackSetUrl,
		stackSetName,
		seedAccounts = '',
		organizationToken,
		organizationKeyId,
	} = process.env;

	const [, , , regionName, managementAccountId] = context.invokedFunctionArn.split(':');

	const AWS = require('aws-sdk');
	const CloudFormation = new AWS.CloudFormation();

	let firstLaunch = false;

	// Describe the provided stack set, error means it doesn't exist yet
	try {
		await CloudFormation.describeStackSet({ StackSetName: stackSetName }).promise();

		console.log(`Stack set ${stackSetName} exists in region ${regionName} in account ${managementAccountId}.`);

		return stackSetName;
	} catch (e) {
		console.log(`Stack set ${stackSetName} does not exist in region ${regionName} in account ${managementAccountId}, starting creation.`);
		firstLaunch = true;
	};

	// If it doesn't exist yet, create the stack set
	await CloudFormation.createStackSet({
		StackSetName: stackSetName,
		Description: 'Control Tower Management account stack set responsible for orchestrating any enrolled accounts\' setup with Druva CloudRanger',
		TemplateURL: stackSetUrl,
		Parameters: [
			{
				ParameterKey: 'OrganizationToken',
				ParameterValue: organizationToken,
				UsePreviousValue: false,
				ResolvedValue: 'string',
			},
			{
				ParameterKey: 'OrganizationKeyId',
				ParameterValue: organizationKeyId,
				UsePreviousValue: false,
				ResolvedValue: 'string',
			}
		],
		Capabilities: [
			'CAPABILITY_NAMED_IAM'
		],
		AdministrationRoleARN: `arn:aws:iam::${managementAccountId}:role/service-role/AWSControlTowerStackSetRole`,
		ExecutionRoleName: 'AWSControlTowerExecution',
	}).promise();

	// Describe the newly created stack set
	try {
		await CloudFormation.describeStackSet({ StackSetName: stackSetName }).promise();

		console.log(`Stack set ${stackSetName} deployed in region ${regionName} in account ${managementAccountId}`);
	} catch (e) {
		console.log('An exception occurred trying to describe the new stack');
		throw e;
	};

	// Send an SNS event for each account in the provided list
	if (firstLaunch && seedAccounts.length) {
		const SNS = new AWS.SNS();
		const accountIdList = seedAccounts.split(',');
		const message = {
			stackSetName: {
				targetAccounts: accountIdList,
				targetRegions: [stackRegion]
			}
		};

		try {
			const publishResponse = await SNS.publish({
				TopicArn: stackSNS,
				Message: JSON.stringify(message)
			}).promise();
			console.log('SNS Event sent with payload: ', JSON.stringify(publishResponse, null, 4));
		} catch (e) {
			console.log('An exception occurred trying to describe the new stack', JSON.stringify(e, null, 4));
		};
	}

	return stackSetName;
}

/**
 * This function will perform the following actions:
 * 1. Delete any stack set instances that are part of a target account
 * 2. Delete stack set instance in management account
 * @param  {} context
 */
async function deleteStackSet(context) {
	const AWS = require('aws-sdk');
	const { stackSetName } = process.env;
	const CloudFormation = new AWS.CloudFormation();

	console.log('1')
	// Verify the management account stack set exists
	try {
		console.log('2')
		await CloudFormation.describeStackSet({ StackSetName: stackSetName }).promise();
	} catch (e) {
		console.log('3')
		console.log(`Stack set ${stackSetName} does not exist`);
		return true;
	}

	// Describe all stack set instances
	console.log('4')
	const stackSetInstances = await getAllStackSetInstances(stackSetName);

	const regionList = [];
	const accountList = [];

	// Populate unique regions and accounts
	stackSetInstances.forEach(({ Region, Account }) => {
		if (!regionList.includes(Region)) {
			regionList.push(Region);
		};
		if (!accountList.includes(Account)) {
			accountList.push(Account);
		};
	});

	console.log('5')
	// If there are any accounts where a stack set instance is deployed, delete their stack instances
	if (accountList.length) {
		const waitTime = 30 // seconds
		let remainingTime = (context.getRemainingTimeInMillis() - 100) / 1000 // remaining time in seconds
		const { OperationId } = await CloudFormation.deleteStackInstances({
			Regions: regionList,
			Accounts: accountList,
			StackSetName: stackSetName,
			RetainStacks: false,
		}).promise();

		let status = 'RUNNING';

		// Repeat the describe operation until it's complete or there's no time left
		while (status === 'RUNNING' && remainingTime > 0) {
			await wait(waitTime);

			remainingTime -= waitTime

			const describeStackSetOperationResult = await CloudFormation.describeStackSetOperation({ StackSetName: stackSetName, OperationId }).promise();

			status = describeStackSetOperationResult.StackSetOperation.Status;

			console.log(`Stackset instances deletion status: ${status}`);
		}
	}
	try {
		// Attempt to delete the management account stack set
		const deleteStackSetResult = await CloudFormation.deleteStackSet({ StackSetName: stackSetName }).promise();
		console.log('Initiated delete for management stack set: ', JSON.stringify(deleteStackSetResult, null, 4));
	} catch (e) {
		console.log('A problem occurred while trying to delete the stack set', JSON.stringify(e, null, 4))
	}
	console.log('6')
	return;
}

async function getAllStackSetInstances(stackSetName) {
	const stackSets = [];

	async function getStackSetInstances(stackSetName, nextToken) {
		const AWS = require('aws-sdk');
		const CloudFormation = new AWS.CloudFormation();
		const listStackInstancesParams = {
			NextToken: nextToken,
			StackSetName: stackSetName,
		};
		const { Summaries, NextToken } = await CloudFormation.listStackInstances(listStackInstancesParams).promise();

		stackSets.push(...Summaries);

		if (NextToken) {
			await getStackSetInstances(stackSetName, NextToken);
		} else {
			return stackSets;
		};
	}

	return getStackSetInstances(stackSetName);
}

function wait(timeInMillis) {
	return new Promise(resolve => setTimeout(() => resolve(), timeInMillis));
}