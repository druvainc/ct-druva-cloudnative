## AWS Control Tower integration for Druva CloudRanger

### Flow steps

## Entry point 1 - New setup
1. A Control Tower administrator deploys the Druva CloudRanger QuickStart
2. This runs the `control-tower.yml` CloudFormation script, creating the required infrastructure
3. The final step in the CloudFormation script, invokes the *onboarding* function (see `DruvaCloudRangerFirstLaunch` resource)
4. The *onboarding* function initiates the creation of the StackSet in the control tower account

**If the Control Tower administrator has provided a list of seed accounts**

5. The *onboarding* function invokes the *stackset* function, passing the list of seed accounts
6. The *stackset* function prepares a template for each seed account
7. The *stackset* function deploys a stack set instance for each seed account

## Linting JavaScript
Install ESLint
> npm install -g eslint
> eslint .

## Linting CloudFormation templates
Install cfn-lint
> npm install -g cfn-lint

> cfn-lint validate templates/cloudranger.json

> cfn-lint validate templates/control-tower.json
