/**
 * This function will be executed when first running the template in the management account or for cleaning up the installation in the management account
 * @param {*} event
 * @param {*} context
 * @returns
 */

exports.handler = async (event, context) => {
	console.log('Received event', JSON.stringify(event, null, 4));

	try {
		if (['create', 'update'].includes(event.RequestType)) {
			return createOrUpdateStackSet(context);
		} else if (['delete'].includes(event.RequestType)) {
			return deleteStackSet(context);
		}
	} catch (e) {
		console.log('Onboarding function has encountered an error', JSON.stringify(e, null, 4));
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
		stackSetUrl,
		stackSetName,
		seedAccounts = '',
		organizationToken,
	} = process.env;

	const [, , , regionName, managementAccountId] = context.invoked_function_arn.split(':');

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
				targetRegions: [regionName]
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
	const { stackSetName } = process.env;
	const CloudFormation = new AWS.CloudFormation();

	// Verify the management account stack set exists
	try {
		await CloudFormation.describeStackSet({ StackSetName: stackSetName }).promise();
	} catch (e) {
		console.log(`Stack set ${stackSetName} does not exist`);
		return;
	}

	// Describe all stack set instances
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

	// If there are any accounts where a stack set instance is deployed, delete their stack instances
	if (accountList.length) {
		const waitTime = 30 // seconds
		let remainingTime = (context.get_remaining_time_in_millis() - 100) / 1000 // remaining time in seconds
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

		// Attempt to delete the management account stack set
		const deleteStackSetResult = await CloudFormation.deleteStackSet({ StackSetName: stackSetName }).promise();
		console.log('Initiated delete for management stack set: ', JSON.stringify(deleteStackSetResult, null, 4));
	}

	return;
}

async function getAllStackSetInstances(stackSetName) {
	const stackSets = [];

	async function getStackSetInstances(stackSetName, nextToken) {
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

function wait (timeInMillis) {
	return new Promise(resolve => setTimeout(() => resolve(), timeInMillis));
}