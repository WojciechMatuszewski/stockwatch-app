import * as LambdaGo from "@aws-cdk/aws-lambda-go-alpha";
import {
  aws_apigateway,
  aws_dynamodb,
  aws_events,
  aws_lambda,
  aws_stepfunctions,
  aws_stepfunctions_tasks,
  CfnOutput,
  CustomResource,
  custom_resources,
  Stack,
  StackProps
} from "aws-cdk-lib";
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

    new SymbolsPriceDeltaSetter(this, "SymbolsPriceDeltaSetter", {
      dataTable: dataTable.table
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
        resultSelector: {
          "symbols.$": "$.Items"
        },
        iamResources: [props.dataTable.tableArn]
      }
    );

    const symbolMapper = new aws_stepfunctions.Pass(this, "SymbolMapper", {
      parameters: {
        "symbol.$": "$.SK.S",
        "name.$": "$.Name.S"
      }
    });
    const mapSymbols = new aws_stepfunctions.Map(this, "MapSymbols", {
      itemsPath: "$.symbols",
      resultPath: "$.symbols"
    }).iterator(symbolMapper);

    const fetchPriceForSymbolTask =
      new aws_stepfunctions_tasks.CallApiGatewayRestApiEndpoint(
        this,
        "FetchPriceForSymbolTask",
        {
          api: props.symbolDataFetcher,
          stageName: "prod",
          method: aws_stepfunctions_tasks.HttpMethod.GET,
          queryParameters: aws_stepfunctions.TaskInput.fromObject({
            "symbol.$":
              "States.StringToJson(States.Format('[\"{}\"]', $.symbol))",
            token: ["c6uv32aad3i9k7i70shg"]
          }),
          resultSelector: {
            "price.$": "$.ResponseBody.c[(@.length - 1)]"
          },
          resultPath: "$.price"
        }
      );

    const mapToSymbolPrices = new aws_stepfunctions.Map(
      this,
      "FetchPriceForSymbolMapper",
      {
        itemsPath: "$.symbols",
        maxConcurrency: 1
      }
    ).iterator(fetchPriceForSymbolTask);

    const savePriceTask = new aws_stepfunctions_tasks.DynamoPutItem(
      this,
      "SavePriceTask",
      {
        table: props.dataTable,
        item: {
          PK: aws_stepfunctions_tasks.DynamoAttributeValue.fromString("PRICE"),
          SK: aws_stepfunctions_tasks.DynamoAttributeValue.fromString(
            aws_stepfunctions.JsonPath.stringAt("$.symbol")
          ),
          /**
           * How does DynamoDB store numbers? Should we use string here?
           * "Number overflow. Attempting to store a number with magnitude larger than supported range (Service: AmazonDynamoDBv2; Status Code: 400; Error Code: ValidationException; Request ID: 53985e02-76f3-4339-83c3-271ce0573d65; Proxy: null)"
           * https://github.com/aws/aws-cdk/issues/12456
           */
          Price: aws_stepfunctions_tasks.DynamoAttributeValue.numberFromString(
            aws_stepfunctions.JsonPath.stringAt(
              "States.Format('{}', $.price.price)"
            )
          )
        }
      }
    );
    const savePrices = new aws_stepfunctions.Map(this, "SavePrices", {
      itemsPath: "$"
    }).iterator(savePriceTask);

    const machineDefinition = fetchSymbolsTask
      .next(mapSymbols)
      .next(mapToSymbolPrices)
      .next(savePrices);

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

interface SymbolsPriceDeltaSetterProps {
  dataTable: ITable;
}
class SymbolsPriceDeltaSetter extends Construct {
  constructor(
    scope: Construct,
    id: string,
    props: SymbolsPriceDeltaSetterProps
  ) {
    super(scope, id);

    const functionEntry = join(
      __dirname,
      "../../src/functions/symbols_price_delta"
    );
    const symbolsPriceDeltaFunction = new LambdaGo.GoFunction(
      this,
      "SymbolsPriceDeltaFunction",
      {
        entry: functionEntry,
        environment: {
          TABLE_NAME: props.dataTable.tableName
        }
      }
    );
    props.dataTable.grantWriteData(symbolsPriceDeltaFunction);
    props.dataTable.grantStreamRead(symbolsPriceDeltaFunction);

    const ESM = new aws_lambda.CfnEventSourceMapping(
      this,
      "SymbolsPriceDeltaEventSourceMapping",
      {
        functionName: symbolsPriceDeltaFunction.functionName,
        eventSourceArn: props.dataTable.tableStreamArn,
        startingPosition: "LATEST",
        filterCriteria: {
          Filters: [
            {
              Pattern:
                '{"eventName": ["MODIFY", "INSERT"],"dynamodb": {"NewImage": {"PK": {"S": ["PRICE"]}}}}'
            }
          ]
        },
        maximumRetryAttempts: 1,
        batchSize: 10,
        functionResponseTypes: ["ReportBatchItemFailures"],
        maximumBatchingWindowInSeconds: 5
      }
    );
  }
}

interface SymbolsPriceDeltaEventSenderProps {
  dataTable: ITable;
}
class SymbolsPriceDeltaEventSender extends Construct {
  constructor(
    scope: Construct,
    id: string,
    props: SymbolsPriceDeltaEventSenderProps
  ) {
    super(scope, id);

    const functionEntry = join(
      __dirname,
      "../../src/functions/symbols_price_delta_event_sender"
    );
    const symbolsPriceDeltaEventSenderFunction = new LambdaGo.GoFunction(
      this,
      "SymbolsPriceDeltaEventSenderFunction",
      {
        entry: functionEntry,
        environment: {
          TABLE_NAME: props.dataTable.tableName
        }
      }
    );
    props.dataTable.grantStreamRead(symbolsPriceDeltaEventSenderFunction);

    const ESM = new aws_lambda.CfnEventSourceMapping(
      this,
      "SymbolsPriceDeltaEventSenderEventSourceMapping",
      {
        functionName: symbolsPriceDeltaEventSenderFunction.functionName,
        eventSourceArn: props.dataTable.tableStreamArn,
        startingPosition: "LATEST",
        filterCriteria: {
          Filters: [
            {
              Pattern:
                '{"eventName": ["MODIFY", "INSERT"],"dynamodb": {"NewImage": {"PK": {"S": ["DELTA"]}}}}'
            }
          ]
        },
        maximumRetryAttempts: 1,
        batchSize: 10,
        functionResponseTypes: ["ReportBatchItemFailures"],
        maximumBatchingWindowInSeconds: 5
      }
    );
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
      billingMode: BillingMode.PAY_PER_REQUEST,
      stream: aws_dynamodb.StreamViewType.NEW_AND_OLD_IMAGES
    });
  }
}
