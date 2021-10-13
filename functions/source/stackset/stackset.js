
const AWS = require('aws-sdk')

/**
 * This function is invoked to create a stack set in an AWS account that's part of the stack set in the management account
 * @param {*} event
 * @param {*} context
 */
exports.handler = async (event, context) => {
	console.log('Received event', JSON.stringify(event, null, 4))
	const responder = require('cfn-custom-resource')

	try {
		if ('Records' in event) {
			// Handle SNS event from onboarding
			return handleSNSRecords(event.Records)
		} else if (event?.detail?.eventName === 'CreateManagedAccount') {
			// Handle lifecycle event from control tower
			return handleLifecycleEvent(event)
		}

		return responder.sendResponse({
			Status: 'SUCCESS',
			PhysicalResourceId: event.PhysicalResourceId || context.logStreamName,
		}, event)
	} catch (e) {
		console.log('Encountered an error: ', JSON.stringify(e, null, 4))

		return responder.sendResponse({
			Status: 'FAILED',
			Reason: 'See the details in CloudWatch Log Stream: ' + context.logStreamName,
			PhysicalResourceId: event.PhysicalResourceId || context.logStreamName,
		}, event)
	}
}

async function handleLifecycleEvent (event) {
	if (!event.detail?.serviceEventDetails?.createManagedAccountStatus?.state == 'SUCCEEDED') {
		console.log('Invalid event state, expected: \'SUCCEEDED\'')
		throw 'Invalid event state, expected: \'SUCCEEDED\''
	}

	const accountId = event.detail?.serviceEventDetails?.createManagedAccountStatus?.account?.accountId
	const { stackSetName, stackRegion } = process.env

	console.log(`Processing lifecycle event for ${accountId}`)

	const stackSetInstances = await getAllStackInstances(stackSetName, accountId)

	console.log(`Found ${stackSetInstances.length} instances for stack set ${stackSetName}`)

	if (stackSetInstances.length === 0) {
		console.log(`Creating a new stack set instance for stack set ${stackSetName}, ${stackRegion}, ${accountId}`)
		const record = {
			[stackSetName]: {
				targetAccounts: [accountId],
				targetRegions: [stackRegion],
			}
		}
		return handleSNSRecord(record)

	} else {
		console.log(`Stack set instance already exists for stack set ${stackSetName}, ${stackRegion}, ${accountId}`)
	}
}

async function handleSNSRecords (records) {
	const promises = []

	for (const record of records) {
		try {
			promises.push(
				handleSNSRecord(JSON.parse(record.Sns.Message))
			)
		} catch (e) {
			console.log('Encountered an error handling an SNS record: ', JSON.stringify(record, null, 4))
			console.log(JSON.stringify(e, null, 4))
			continue
		}
	}

	await Promise.all(promises)
}

async function handleSNSRecord (record) {
	const SNS = new AWS.SNS()
	const CloudFormation = new AWS.CloudFormation()
	const { stackSNS, stackRegion } = process.env

	const promises = Object.entries(record).map(async ([stackSetName, { targetAccounts, targetRegions }]) => {
		console.log(`Processing stackset instances for ${stackSetName}`)
		console.log(`Target accounts: ${targetAccounts}`)
		console.log(`Target region: ${stackRegion}`)

		// Verify the management stack set exists
		try {
			await CloudFormation.describeStackSet({ StackSetName: stackSetName }).promise()
		} catch (e) {
			console.log(`Could not find management stack set: ${stackSetName}`)
			throw e
		}

		const stackSetOperations = await getAllStackSetOperations(stackSetName)

		let operationsInProgress = false
		for (const stackSetOperation of stackSetOperations) {
			if (['RUNNING', 'STOPPING'].includes(stackSetOperation.Status)) {
				operationsInProgress = true
				break
			}
		}

		// If any stack set operations are already in progress, requeue this function in X seconds
		if (operationsInProgress) {
			await wait(20)
			const publishParams = {
				TopicArn: stackSNS,
				Message: JSON.stringify({ stackSetName: { targetAccounts, targetRegions } }),
			}

			try {
				const publishResponse = await SNS.publish(publishParams).promise()
				console.log('Re-queued for stack set instance creation: ', JSON.stringify(publishResponse, null, 4))
			} catch (e) {
				console.log('Failed to send trigger for instance creation: ', JSON.stringify(e, null, 4))
			}
		} else {

			// Retrieve secret ARN's from environment variables
			// const { organizationKeyIdSecretArn, organizationTokenSecretArn } = process.env

			// Retrieve parameters from AWS Secrets Manager
			// const [ organizationKeyId, organizationToken ] = await Promise.all([
			// 	getSecretValue(organizationKeyIdSecretArn),
			// 	getSecretValue(organizationTokenSecretArn),
			// ])

			// Create the stack instances with the parameters being populated by secrets
			const createStackInstancesResult = await CloudFormation.createStackInstances({
				Regions: targetRegions,
				Accounts: targetAccounts,
				StackSetName: stackSetName,
			}).promise()

			console.log('Created stack instances', JSON.stringify(createStackInstancesResult, null, 4))
		}
	})

	return Promise.all(promises)
}

// async function getSecretValue (SecretId) {
// 	try {
// 		const SecretsManager = new AWS.SecretsManager()
// 		const { SecretString } = await SecretsManager.getSecretValue({ SecretId }).promise()
// 		return SecretString
// 	} catch (e) {
// 		console.log(`An error occurred when trying to fetch the secret ${SecretId}`, JSON.stringify(e, null, 4))
// 	}
// }

async function getAllStackSetOperations (stackSetName) {
	const stackSetOperations = []

	async function getStackSetOperations (stackSetName, nextToken) {
		const CloudFormation = new AWS.CloudFormation()
		const listStackSetOperations = {
			NextToken: nextToken,
			StackSetName: stackSetName,
		}
		const { Summaries, NextToken } = await CloudFormation.listStackSetOperations(listStackSetOperations).promise()
		stackSetOperations.push(...Summaries)

		if (NextToken) {
			await getStackSetOperations(stackSetName, NextToken)
		} else {
			return stackSetOperations
		}
	}

	return getStackSetOperations(stackSetName)
}

async function getAllStackInstances (stackSetName, accountId) {
	const stackInstances = []

	async function getStackInstances (stackSetName, nextToken) {
		const CloudFormation = new AWS.CloudFormation()
		const listStackInstancesParams = {
			NextToken: nextToken,
			StackSetName: stackSetName,
			StackInstanceAccount: accountId
		}
		const { Summaries, NextToken } = await CloudFormation.listStackInstances(listStackInstancesParams).promise()
		stackInstances.push(...Summaries)

		if (NextToken) {
			await getStackInstances(stackSetName, NextToken)
		} else {
			return stackInstances
		}
	}

	return getStackInstances(stackSetName)
}

// async function getOrgToken () {
// 	const SSM = new AWS.SSM()
// 	const { Parameter: { Value } } = await SSM.getParameter({ Name: 'DruvaCloudRangerOrgToken', }).promise()

// 	return Value
// }

function wait (timeInMillis) {
	return new Promise(resolve => setTimeout(() => resolve(), timeInMillis))
}
