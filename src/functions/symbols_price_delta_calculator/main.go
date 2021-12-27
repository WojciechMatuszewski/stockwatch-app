package main

import (
	"context"
	"os"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	dynamodbattributevalue "github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
)

func main() {
	lambda.Start(handler)
}

type Output struct {
	BatchItemFailures []string `json:"batchItemFailures"`
}

type Item struct {
	PK    string  `dynamodbav:"PK"`
	SK    string  `dynamodbav:"SK"`
	Delta float64 `dynamodbav:"Delta"`
}

func handler(ctx context.Context, event events.DynamoDBEvent) (Output, error) {
	cfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		panic(err)
	}

	db := dynamodb.NewFromConfig(cfg)

	var batchItemFailures []string
	for _, record := range event.Records {

		item, err := proccessRecord(record)
		if err != nil {
			batchItemFailures = append(batchItemFailures, record.EventID)
			return Output{BatchItemFailures: batchItemFailures}, nil
		}

		av, err := dynamodbattributevalue.MarshalMap(item)
		if err != nil {
			batchItemFailures = append(batchItemFailures, record.EventID)
			return Output{BatchItemFailures: batchItemFailures}, nil
		}

		_, err = db.PutItem(ctx, &dynamodb.PutItemInput{
			Item:      av,
			TableName: aws.String(os.Getenv("TABLE_NAME")),
		})
		if err != nil {
			batchItemFailures = append(batchItemFailures, record.EventID)
			return Output{BatchItemFailures: batchItemFailures}, nil
		}
	}

	return Output{
		BatchItemFailures: batchItemFailures,
	}, nil
}

func proccessRecord(record events.DynamoDBEventRecord) (Item, error) {
	oldImage := record.Change.OldImage
	newImage := record.Change.NewImage

	oldPrice, err := oldImage["Price"].Float()
	if err != nil {
		return Item{}, err
	}

	newPrice, err := newImage["Price"].Float()
	if err != nil {
		return Item{}, err
	}
	delta := newPrice - oldPrice

	symbol := newImage["SK"].String()
	item := Item{
		PK:    "DELTA",
		SK:    symbol,
		Delta: delta,
	}

	return item, nil
}
