PROJECT = DruvaCloudRangerOnboarding
DIR_NAME = onboarding
FUNCTION = $(PROJECT)
DIST_DIR ?= "$(BASE)"/functions/packages/$(DIR_NAME)

all: build

.PHONY: build

build: zip -r $(DIST_DIR)/$(FUNCTION).zip . -x "Makefile"

