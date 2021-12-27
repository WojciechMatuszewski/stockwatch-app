package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"stockwatchapp/symbol_event"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/sns"
	snstypes "github.com/aws/aws-sdk-go-v2/service/sns/types"
)

func main() {
	lambda.Start(handler)
}

func handler(ctx context.Context, event events.CloudWatchEvent) error {
	cfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		panic(err)
	}

	var evt symbol_event.Event

	rawEvtB, err := event.Detail.MarshalJSON()
	if err != nil {
		panic(err)
	}

	fmt.Println(string(rawEvtB))

	err = json.Unmarshal(rawEvtB, &evt)
	if err != nil {
		panic(err)
	}

	topicArn := os.Getenv("TOPIC_ARN")
	if topicArn == "" {
		panic(errors.New("TOPIC_ARN is not set"))
	}
	snsClient := sns.NewFromConfig(cfg)

	if evt.IsPriceDeltaEvent() {
		var priceDeltaEvt symbol_event.PriceDeltaEvent

		err = priceDeltaEvt.UnmarshalJSON(rawEvtB)
		if err != nil {
			panic(err)
		}

		_, err = snsClient.Publish(ctx, &sns.PublishInput{
			Message:  aws.String(string(rawEvtB)),
			TopicArn: aws.String(topicArn),
			Subject:  aws.String(fmt.Sprintf("PriceDeltaEvent: %s", priceDeltaEvt.Symbol)),
			// Filtering on the subscription level based on those attributes
			MessageAttributes: map[string]snstypes.MessageAttributeValue{
				"symbol": {
					DataType:    aws.String("String"),
					StringValue: aws.String(priceDeltaEvt.Symbol),
				},
				"type": {
					DataType:    aws.String("String"),
					StringValue: aws.String(priceDeltaEvt.Type),
				},
				"price_delta": {
					DataType:    aws.String("Number"),
					StringValue: aws.String(fmt.Sprintf("%f", priceDeltaEvt.Delta)),
				},
			},
		})
		if err != nil {
			panic(err)
		}

		fmt.Println("Published", priceDeltaEvt.Type, "event")
	}

	if evt.IsPriceEvent() {
		var priceEvt symbol_event.PriceEvent

		err = priceEvt.UnmarshalJSON(rawEvtB)
		if err != nil {
			panic(err)
		}

		_, err = snsClient.Publish(ctx, &sns.PublishInput{
			Message:  aws.String(string(rawEvtB)),
			TopicArn: aws.String(topicArn),
			Subject:  aws.String(fmt.Sprintf("PriceEvent: %s", priceEvt.Symbol)),
			MessageAttributes: map[string]snstypes.MessageAttributeValue{
				"symbol": {
					DataType:    aws.String("String"),
					StringValue: aws.String(priceEvt.Symbol),
				},
				"type": {
					DataType:    aws.String("String"),
					StringValue: aws.String(priceEvt.Type),
				},
				"price": {
					DataType:    aws.String("Number"),
					StringValue: aws.String(fmt.Sprintf("%f", priceEvt.Price)),
				},
			},
		})
		if err != nil {
			panic(err)
		}

		fmt.Println("Published", priceEvt.Type, "event")
	}

	return nil
}
