package main

import (
	"context"
	"encoding/json"
	"fmt"
	"stockwatchapp/symbol_event"

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

	var batchItemFailures []string

	eb := eventbridge.NewFromConfig(cfg)
	var events []eventbridgetypes.PutEventsRequestEntry

	for _, record := range event.Records {

		if record.Change.Keys["PK"].String() == "PRICE" {
			event, err := eventRecordForPriceChange(record)
			if err != nil {
				fmt.Println(err)
				batchItemFailures = append(batchItemFailures, record.EventID)
				continue
			}

			events = append(events, event)
		}

		if record.Change.Keys["PK"].String() == "DELTA" {
			event, err := eventRecordForPriceDeltaChange(record)
			if err != nil {
				fmt.Println(err)
				batchItemFailures = append(batchItemFailures, record.EventID)
				continue
			}

			events = append(events, event)
		}
	}
	if len(batchItemFailures) > 0 {
		return Output{BatchItemFailures: batchItemFailures}, nil
	}

	out, err := eb.PutEvents(ctx, &eventbridge.PutEventsInput{
		Entries: events,
	})
	if err != nil {
		fmt.Println(err)
		for _, record := range event.Records {
			batchItemFailures = append(batchItemFailures, record.EventID)
		}

		return Output{BatchItemFailures: batchItemFailures}, err
	}

	// TODO: How to handle the errors?
	if out.FailedEntryCount > 0 {
		return Output{BatchItemFailures: []string{}}, nil
	}

	return Output{BatchItemFailures: []string{}}, nil
}

func eventRecordForPriceDeltaChange(record events.DynamoDBEventRecord) (eventbridgetypes.PutEventsRequestEntry, error) {
	delta, err := record.Change.NewImage["Delta"].Float()
	if err != nil {
		return eventbridgetypes.PutEventsRequestEntry{}, err
	}

	detail := symbol_event.NewPriceDeltaEvent(
		record.Change.Keys["SK"].String(),
		delta,
	)
	detailStr, err := json.Marshal(detail)
	if err != nil {
		return eventbridgetypes.PutEventsRequestEntry{}, err
	}

	event := eventbridgetypes.PutEventsRequestEntry{
		Detail:       aws.String(string(detailStr)),
		DetailType:   aws.String("SymbolPriceDeltaEvent"),
		EventBusName: nil,
		Source:       aws.String("stockwatch"),
	}

	return event, nil
}

func eventRecordForPriceChange(record events.DynamoDBEventRecord) (eventbridgetypes.PutEventsRequestEntry, error) {
	price, err := record.Change.NewImage["Price"].Float()
	if err != nil {
		return eventbridgetypes.PutEventsRequestEntry{}, err
	}

	detail := symbol_event.NewPriceEvent(
		record.Change.Keys["SK"].String(),
		price,
	)
	detailStr, err := json.Marshal(detail)
	if err != nil {
		return eventbridgetypes.PutEventsRequestEntry{}, err
	}

	event := eventbridgetypes.PutEventsRequestEntry{
		Detail:       aws.String(string(detailStr)),
		DetailType:   aws.String("SymbolPriceEvent"),
		EventBusName: nil,
		Source:       aws.String("stockwatch"),
	}

	return event, nil
}
