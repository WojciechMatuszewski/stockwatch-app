package main

import (
	"context"

	"github.com/aws/aws-lambda-go/cfn"
	"github.com/aws/aws-lambda-go/lambda"
)

func main() {
	lambda.Start(cfn.LambdaWrap(newHandler()))
}

func newHandler() cfn.CustomResourceFunction {
	return func(c context.Context, e cfn.Event) (physicalResourceID string, data map[string]interface{}, err error) {
		return
	}
}

// tableName, found := event.ResourceProperties["TableName"].(string)
// if (!found) || (tableName == "") {
// 	err = errors.New("TableName is required")
// 	return physicalResourceID, data, err
// }

// symbols, found := event.ResourceProperties["Symbols"].(map[string]interface{})
// if (!found) || (len(symbols) == 0) {
// 	err = errors.New("Symbols are required")
// 	return physicalResourceID, data, err
// }

// fmt.Println(tableName, symbols)

// return physicalResourceID, data, err
