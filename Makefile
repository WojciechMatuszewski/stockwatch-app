.PHONY: synth, bootstrap, deploy

synth:
	npx aws-cdk@2.x synth

bootstrap:
	npx aws-cdk@2.x bootstrap

deploy:
	npx aws-cdk@2.x deploy -- --hotswap


