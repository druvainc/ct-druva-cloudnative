exports.handler = async (event, context) => {
	console.log('Received event', JSON.stringify(event, null, 4))

	const AWS = require('aws-sdk')

	try {
		if ('Records' in event) {
			// Handle SNS event from onboarding
			handleSNSRecords(event.Records)
		} else if (event?.detail?.eventName === 'CreateManagedAccount') {

		}
	} catch (e) {
		console.log('Encountered an error', JSON.stringify(e, null, 4))
	}

	async function handleSNSRecords (records) {
		for (const record of records) {
			handleSNSRecord(JSON.parse(record.Sns.Message))
		}
	}

	async function handleSNSRecord (record) {
		const SNS = new AWS.SNS()
		const CloudFormation = new AWS.CloudFormation()
	}
}