## AWS Control Tower integration for Druva CloudRanger

### Prerequisites for jekyll docs (Windows)
Installing GCC

1. Download MinGW: https://sourceforge.net/projects/mingw/files/Installer/mingw-get-setup.exe/download
2. Select the MinGW-gcc-g++ bin for installation
3. Select Installation > Apply changes
4. Wait an eternity
5. Add C:\MinGW\bin to system environment PATH variable
6. Verify with gcc --version

Install Ruby > 2.5

1. Download Installer: https://www.ruby-lang.org/en/documentation/installation/
2. Verify with ruby -v and gem -v


### Flow steps

## Entry point 1 - New setup
1. A Control Tower administrator deploys the Druva CloudRanger QuickStart
2. This runs the `control-tower.yml` CloudFormation script, creating the required infrastructure
3. The final step in the CloudFormation script, invokes the *onboarding* function (see `DruvaCloudRangerFirstLaunch` resource)
4. The *onboarding* function initiates the creation of the StackSet in the control tower account

**If the Control Tower administrator has provided a list of seed accounts**

5. The *onboarding* function invokes the *stackset* function, passing the list of seed accounts
6. The *stackset* function prepares a template for each seed account
7. The *stackset* function deployed a stack set instance for each seed account


TODO:
Taskcat
CFNLint
ESLint