
const AWS = require('aws-sdk');

/**
 * This function is invoked to create a stack set in an AWS account that's part of the stack set in the management account
 * @param {*} event
 * @param {*} context
 */
exports.handler = async (event, context) => {
	console.log('Received event', JSON.stringify(event, null, 4));

	try {
		if ('Records' in event) {
			// Handle SNS event from onboarding
			return handleSNSRecords(event.Records);
		} else if (event?.detail?.eventName === 'CreateManagedAccount') {

		};
	} catch (e) {
		console.log('Encountered an error: ', JSON.stringify(e, null, 4));
	}
}

async function handleSNSRecords (records) {
	const promises = [];

	for (const record of records) {
		try {
			promises.push(
				handleSNSRecord(JSON.parse(record.Sns.Message))
			);
		} catch (e) {
			console.log('Encountered an error handling an SNS record: ', JSON.stringify(record, null, 4));
			console.log(JSON.stringify(e, null, 4));
			continue;
		};
	};

	await Promise.all(promises);
}

async function handleSNSRecord (record) {
	const SNS = new AWS.SNS();
	const CloudFormation = new AWS.CloudFormation();
	const { stackSNS } = process.env

	const promises = [];

	for (const [stackSetName, { targetAccounts, targetRegions }] of Object.entries(record)) {
		console.log(`Processing stackset instances for ${stackSetName}`);
		console.log(`Target accounts: ${targetAccounts}`);
		console.log(`Target regions: ${targetRegions}`);

		// Verify the management stack set exists
		try {
			await CloudFormation.describeStackSet({ StackSetName: stackSetName }).promise();
		} catch (e) {
			console.log(`Could not find management stack set: ${stackSetName}`);
			throw e;
		}

		const stackSetOperations = await getAllStackSetOperations(stackSetName);

		let operationsInProgress = false;
		for (const stackSetOperation of stackSetOperations) {
			if (['RUNNING', 'STOPPING'].includes(stackSetOperation.Status)) {
				operationsInProgress = true;
				break;
			};
		};

		// If any stack set operations are already in progress, requeue this function in X seconds
		if (operationsInProgress) {
			await wait(20);
			const publishParams = {
				TopicArn: stackSNS,
				Message: JSON.stringify({ stackSetName: { targetAccounts, targetRegions } }),
			};

			try {
				const publishResponse = await SNS.publish(publishParams).promise();
				console.log('Re-queued for stack set instance creation: ', JSON.stringify(publishResponse, null, 4));
			} catch (e) {
				console.log('Failed to send trigger for instance creation: ', JSON.stringify(e, null, 4));
			}
		} else {

		}
	};
}

async function getAllStackSetOperations(stackSetName) {
	const stackSetOperations = [];

	async function getStackSetOperations(stackSetName, nextToken) {
		const CloudFormation = new AWS.CloudFormation();
		const listStackSetOperations = {
			NextToken: nextToken,
			StackSetName: stackSetName,
		};
		const { Summaries, NextToken } = await CloudFormation.listStackSetOperations(listStackSetOperations).promise();
		stackSetOperations.push(...Summaries);

		if (NextToken) {
			await getStackSetOperations(stackSetName, NextToken);
		} else {
			return stackSetOperations;
		};
	}

	return getStackSetOperations(stackSetName);
}

async function getOrgToken () {
	const SSM = new AWS.SSM();
	const { Parameter: { Value } } = await SSM.getParameter({ Name: 'DruvaCloudRangerOrgToken', }).promise()

	return Value;
}

function wait (timeInMillis) {
	return new Promise(resolve => setTimeout(() => resolve(), timeInMillis));
}
