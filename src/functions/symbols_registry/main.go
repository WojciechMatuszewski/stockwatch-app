package main

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/aws/aws-lambda-go/cfn"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	dynamodbtypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

func main() {
	lambda.Start(cfn.LambdaWrap(newHandler()))
}

type SymbolData struct {
	Name   string `json:"name"`
	Symbol string `json:"symbol"`
}

func newHandler() cfn.CustomResourceFunction {
	return func(ctx context.Context, event cfn.Event) (physicalResourceID string, data map[string]interface{}, err error) {
		tableName, found := event.ResourceProperties["TableName"].(string)
		if !found {
			err = errors.New("TableName is required")
			panic(err)
		}

		rawSymbols, found := event.ResourceProperties["Symbols"].(string)
		if !found {
			err = errors.New("symbols are required")
			panic(err)
		}

		var symbols []SymbolData
		err = json.Unmarshal([]byte(rawSymbols), &symbols)
		if err != nil {
			err = errors.New("failed to unmarshal symbols")
			panic(err)
		}

		cfg, err := config.LoadDefaultConfig(ctx)
		if err != nil {
			panic(err)
		}

		ddb := dynamodb.NewFromConfig(cfg)

		/**
				Received response status [FAILED] from custom resource. Message returned: Error: operation error DynamoDB: BatchWriteItem, https response error StatusCode: 400, RequestID: O4KE
		QNESP1QAK1VMHTBBH2N2CBVV4KQNSO5AEMVJF66Q9ASUAAJG, api error ValidationException: Supplied AttributeValue has more than one datatypes set, must contain exactly one of the suppor
		ted datatypes
		*/

		symbolsWriteRequests := make([]dynamodbtypes.WriteRequest, len(symbols))
		for i, symbol := range symbols {
			symbolWriteRequest := dynamodbtypes.WriteRequest{
				PutRequest: &dynamodbtypes.PutRequest{
					Item: map[string]dynamodbtypes.AttributeValue{
						"PK": &dynamodbtypes.AttributeValueMemberS{
							Value: "SYMBOL",
						},
						"SK": &dynamodbtypes.AttributeValueMemberS{
							Value: symbol.Symbol,
						},
						"Name": &dynamodbtypes.AttributeValueMemberS{
							Value: symbol.Name,
						},
					},
				},
			}
			symbolsWriteRequests[i] = symbolWriteRequest
		}

		out, err := ddb.BatchWriteItem(ctx, &dynamodb.BatchWriteItemInput{
			RequestItems: map[string][]dynamodbtypes.WriteRequest{
				tableName: symbolsWriteRequests,
			},
		})
		if err != nil {
			panic(err)
		}

		if len(out.UnprocessedItems) > 0 {
			panic("unprocessed items")
		}

		return physicalResourceID, data, err
	}
}
