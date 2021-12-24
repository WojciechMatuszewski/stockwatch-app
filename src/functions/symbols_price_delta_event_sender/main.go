package main

import (
	"context"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/eventbridge"
	eventbridgetypes "github.com/aws/aws-sdk-go-v2/service/eventbridge/types"
)

func main() {
	lambda.Start(handler)
}

type Output struct {
	BatchItemFailures []string `json:"batchItemFailures"`
}

func handler(ctx context.Context, event events.DynamoDBEvent) (Output, error) {
	cfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		panic(err)
	}

	eb := eventbridge.NewFromConfig(cfg)

	var events []eventbridgetypes.PutEventsRequestEntry
	for _, record := range event.Records {
		events = append(events, eventbridgetypes.PutEventsRequestEntry{
			Detail:     "",
			DetailType: aws.String(""),
			// Explicitly set to nil – the events will be send to the default bus
			EventBusName: nil,
			Source:       aws.String("stockwatch"),
		})
	}

	eb.PutEvents(ctx, &eventbridge.PutEventsInput{
		Entries: []eventbridgetypes.PutEventsRequestEntry{},
	})

	// var batchItemFailures []string
	// for _, record := range event.Records {

	// }

	return Output{BatchItemFailures: []string{}}, nil
}
