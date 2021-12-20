import {
  aws_dynamodb,
  CustomResource,
  custom_resources,
  Stack,
  StackProps,
  aws_apigateway,
  CfnOutput,
  aws_stepfunctions,
  aws_stepfunctions_tasks
} from "aws-cdk-lib";
import * as LambdaGo from "@aws-cdk/aws-lambda-go-alpha";
import { BillingMode, ITable } from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";
import { join } from "path";

export class StockWatchAppStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const dataTable = new DataTable(this, "DataTable");
    new SymbolsRegistry(this, "SymbolsRegistry", {
      dataTable: dataTable.table
    });

    const symbolDataFetcher = new SymbolDataFetcher(this, "SymbolDataFetcher");

    new SymbolsOrchestrator(this, "SymbolsOrchestrator", {
      dataTable: dataTable.table,
      symbolDataFetcher: symbolDataFetcher.api
    });

    new CfnOutput(this, "SymbolDataFetcherURL", {
      value: symbolDataFetcher.api.url
    });
  }
}

interface SymbolsOrchestratorProps {
  dataTable: aws_dynamodb.ITable;
  symbolDataFetcher: aws_apigateway.RestApi;
}

class SymbolsOrchestrator extends Construct {
  constructor(scope: Construct, id: string, props: SymbolsOrchestratorProps) {
    super(scope, id);

    const fetchSymbolsTask = new aws_stepfunctions_tasks.CallAwsService(
      this,
      "FetchSymbolsTask",
      {
        service: "dynamodb",
        action: "query",
        parameters: {
          TableName: props.dataTable.tableName,
          KeyConditionExpression: "#PK = :PK",
          ExpressionAttributeValues: {
            ":PK": {
              S: "SYMBOL"
            }
          },
          ExpressionAttributeNames: {
            "#PK": "PK"
          }
        },
        // outputPath: "$",
        // resultPath: "$.Items",
        resultSelector: {
          "symbols.$": "$.Items"
        },
        iamResources: [props.dataTable.tableArn]
      }
    );

    const fetchPriceForSymbolTask =
      new aws_stepfunctions_tasks.CallApiGatewayRestApiEndpoint(
        this,
        "FetchPriceForSymbolTask",
        {
          api: props.symbolDataFetcher,
          stageName: "prod",
          method: aws_stepfunctions_tasks.HttpMethod.GET,
          // queryParameters: aws_stepfunctions.TaskInput.fromObject({
          //   "symbol.$": "$.symbols.[0].SK.S",
          //   token: "c6uv32aad3i9k7i70shg"
          // })
          /**
           * How do I make the query parameters to work?
           * "An error occurred while executing the state 'FetchPriceForSymbolTask' (entered at the event id #7). The Parameters '{\"ApiEndpoint\":\"b9tu9lkwh6.execute-api.us-east-1.amazonaws.com\",\"Method\":\"GET\",\"Stage\":\"prod\",\"AuthType\":\"NO_AUTH\",\"QueryParameters\":\"?symbol=BINANCE:BTCUSDT&token=c6uv32aad3i9k7i70shg\"}' could not be used to start the Task: [The value of the field 'QueryParameters' has an invalid format]"
           */
          queryParameters: aws_stepfunctions.TaskInput.fromJsonPathAt(
            "States.Format('?symbol={}&token={}', $.symbols[0].SK.S, 'c6uv32aad3i9k7i70shg')"
          )
        }
      );

    const machineDefinition = fetchSymbolsTask.next(fetchPriceForSymbolTask);

    const machine = new aws_stepfunctions.StateMachine(this, "Machine", {
      definition: machineDefinition
    });
  }
}

class SymbolDataFetcher extends Construct {
  public api: aws_apigateway.RestApi;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.api = new aws_apigateway.RestApi(this, "API");
    // https://finnhub.io/api/v1/quote?symbol=AAPL&token=c6uv32aad3i9k7i70shg
    const integration = new aws_apigateway.HttpIntegration(
      "https://finnhub.io/api/v1/crypto/candle",
      {
        options: {
          requestParameters: {
            "integration.request.querystring.symbol":
              "method.request.querystring.symbol",
            "integration.request.querystring.token":
              "method.request.querystring.token"
          },
          // TODO: Add support for variable resolution parameter.
          requestTemplates: {
            "application/json": `
              #set ( $requestTimeEpochInSeconds = $context.requestTimeEpoch / 1000)
              #set ( $minuteBeforeNow = $requestTimeEpochInSeconds - 60 )
              #set ( $context.requestOverride.querystring.resolution = "1" )
              #set ( $context.requestOverride.querystring.from = "$minuteBeforeNow" )
              #set ( $context.requestOverride.querystring.to = "$requestTimeEpochInSeconds" )
            `
          },
          connectionType: aws_apigateway.ConnectionType.INTERNET,
          /*
           * These have to be hardcoded.
           * There is no way to get the statusCode via VTL.
           * If we could do that, one might override the statusCode using this guide: https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-override-request-response-parameters.html
           */
          integrationResponses: [
            {
              selectionPattern: "2\\d{2}",
              statusCode: "200"
            },
            {
              selectionPattern: "4\\d{2}",
              statusCode: "400"
            },
            {
              selectionPattern: "5\\d{2}",
              statusCode: "500"
            }
          ]
        },
        httpMethod: "GET",
        proxy: false
      }
    );

    this.api.root.addMethod("GET", integration, {
      /**
       * These allow you to specify the `requestParameters` in the integration.
       * If you don't specify them, the integration will not be created and you will get an error.
       */
      requestParameters: {
        "method.request.querystring.symbol": true,
        "method.request.querystring.token": true
      },
      apiKeyRequired: false,
      authorizationType: aws_apigateway.AuthorizationType.NONE,
      methodResponses: [
        { statusCode: "200" },
        { statusCode: "400" },
        { statusCode: "500" }
      ]
    });
  }
}

interface SymbolsRegistryProps {
  dataTable: ITable;
}

class SymbolsRegistry extends Construct {
  constructor(scope: Construct, id: string, props: SymbolsRegistryProps) {
    super(scope, id);

    const functionEntry = join(
      __dirname,
      "../../src/functions/symbols_registry"
    );
    const symbolsRegistryFunction = new LambdaGo.GoFunction(
      this,
      "SymbolsRegistryFunction",
      {
        entry: functionEntry
      }
    );
    props.dataTable.grantWriteData(symbolsRegistryFunction);

    const symbolsRegistryProvider = new custom_resources.Provider(
      this,
      "SymbolsRegistryProvider",
      {
        onEventHandler: symbolsRegistryFunction
      }
    );

    const symbols = [
      { name: "BTC", symbol: "BINANCE:BTCUSDT" },
      { name: "ETH", symbol: "BINANCE:ETHUSDT" }
    ];

    const symbolsRegistryResource = new CustomResource(
      this,
      "SymbolsRegistryResource",
      {
        serviceToken: symbolsRegistryProvider.serviceToken,
        properties: {
          TableName: props.dataTable.tableName,
          Symbols: JSON.stringify(symbols)
        }
      }
    );
  }
}

class DataTable extends Construct {
  public table: ITable;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.table = new aws_dynamodb.Table(this, "DataTable", {
      partitionKey: { name: "PK", type: aws_dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: aws_dynamodb.AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST
    });
  }
}
