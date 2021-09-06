#!/bin/bash
rm -rf ./dist
mkdir ./dist

7z a -tzip ./dist/onboarding.zip ./functions/source/onboarding/*
7z a -tzip ./dist/stackset.zip ./functions/source/stackset/*
cp ./templates/* ./dist

aws s3 sync ./dist s3://druva-cloudranger-ct-assets-demo --acl public-read --profile cloudranger_ct
