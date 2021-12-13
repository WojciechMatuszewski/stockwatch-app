package main

import (
	"github.com/aws/aws-cdk-go/awscdk/v2"
	"github.com/aws/aws-cdk-go/awscdk/v2/awsevents"
	"github.com/aws/aws-cdk-go/awscdk/v2/awseventstargets"
	"github.com/aws/aws-cdk-go/awscdk/v2/awsstepfunctions"
	"github.com/aws/constructs-go/constructs/v10"
	"github.com/aws/jsii-runtime-go"
)

func NewStack(scope constructs.Construct, id string, props awscdk.StackProps) awscdk.Stack {
	stack := awscdk.NewStack(scope, &id, &props)

	machine := newMachine(stack, "Machine")
	newTicker(stack, "Ticker", tickerProps{Machine: machine})

	return stack
}

func newMachine(scope constructs.Construct, id string) awsstepfunctions.StateMachine {
	construct := constructs.NewConstruct(scope, &id)

	machineDefinition := awsstepfunctions.NewPass(construct, jsii.String("Pass"), nil)

	machine := awsstepfunctions.NewStateMachine(construct, jsii.String("Machine"), &awsstepfunctions.StateMachineProps{
		Definition: machineDefinition,
	})

	return machine
}

type tickerProps struct {
	Machine awsstepfunctions.StateMachine
}

func newTicker(scope constructs.Construct, id string, props tickerProps) {
	construct := constructs.NewConstruct(scope, &id)

	// ENABLE IF NEEDED!
	tickerRule := awsevents.NewRule(construct, jsii.String("TickerRule"), &awsevents.RuleProps{
		Enabled:  jsii.Bool(false),
		Schedule: awsevents.Schedule_Rate(awscdk.Duration_Minutes(jsii.Number(1))),
	})

	tickerRule.AddTarget(awseventstargets.NewSfnStateMachine(props.Machine, nil))
}

func newSymbolRegistry(scope constructs.Construct, id string) {}
