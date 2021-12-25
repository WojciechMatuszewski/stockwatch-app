import * as LambdaGo from "@aws-cdk/aws-lambda-go-alpha";
import {
  Aws,
  aws_apigateway,
  aws_dynamodb,
  aws_events,
  aws_events_targets,
  aws_iam,
  aws_lambda,
  aws_lambda_event_sources,
  aws_logs,
  aws_sns,
  aws_sns_subscriptions,
  aws_sqs,
  aws_ssm,
  aws_stepfunctions,
  aws_stepfunctions_tasks,
  CfnOutput,
  CustomResource,
  custom_resources,
  Duration,
  RemovalPolicy,
  Stack,
  StackProps
} from "aws-cdk-lib";
import { BillingMode, ITable } from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";
import { join } from "path";

export class StockWatchAppStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const symbolDataFetcher = new SymbolDataFetcher(this, "SymbolDataFetcher");
    const dataTable = new DataTable(this, "DataTable");

    new SymbolsRegistry(this, "SymbolsRegistry", {
      dataTable: dataTable.table
    });

    new SymbolsPriceOrchestrator(this, "SymbolsOrchestrator", {
      dataTable: dataTable.table,
      symbolDataFetcher: symbolDataFetcher.api
    });

    new SymbolsPriceDeltaSetter(this, "SymbolsPriceDeltaSetter", {
      dataTable: dataTable.table
    });

    new SymbolsPriceEventSender(this, "SymbolsPriceEventSender", {
      dataTable: dataTable.table
    });

    new CfnOutput(this, "SymbolDataFetcherURL", {
      value: symbolDataFetcher.api.url
    });
  }
}

interface SymbolsPriceOrchestratorProps {
  dataTable: aws_dynamodb.ITable;
  symbolDataFetcher: aws_apigateway.RestApi;
}

class SymbolsPriceOrchestrator extends Construct {
  constructor(
    scope: Construct,
    id: string,
    props: SymbolsPriceOrchestratorProps
  ) {
    super(scope, id);

    const symbolsAPIKeyParameter = new aws_ssm.StringParameter(
      this,
      "SymbolsAPIKeyParameter",
      {
        stringValue: "TO_BE_REPLACED_WITH_YOUR_API_KEY",
        description: "finnhub.io API key"
      }
    );

    const fetchSymbolsAPIKeyTask = new aws_stepfunctions_tasks.CallAwsService(
      this,
      "FetchSymbolsAPIKeyTask",
      {
        service: "ssm",
        action: "getParameter",
        parameters: {
          Name: symbolsAPIKeyParameter.parameterName
        },
        iamResources: [symbolsAPIKeyParameter.parameterArn],
        resultSelector: {
          "APIKey.$": "$.Parameter.Value"
        },
        resultPath: "$"
      }
    );

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
        resultPath: "$",
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

    const fetchAPIKeyAndSymbols = new aws_stepfunctions.Parallel(
      this,
      "FetchAPIKeyAndSymbols",
      {
        resultSelector: {
          "APIKey.$": "$[0].APIKey",
          "symbols.$": "$[1].symbols"
        }
      }
    )
      .branch(fetchSymbolsAPIKeyTask)
      .branch(fetchSymbolsTask.next(mapSymbols));

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
              "States.StringToJson(States.Format('[\"{}\"]', $.symbolItem.symbol))",
            "token.$":
              "States.StringToJson(States.Format('[\"{}\"]', $.APIKey))"
          }),
          resultSelector: {
            "price.$": "$.ResponseBody.c[(@.length - 1)]"
          },
          resultPath: "$.symbolItem.price"
        }
      );

    const mapToSymbolPrices = new aws_stepfunctions.Map(
      this,
      "FetchPriceForSymbolMapper",
      {
        itemsPath: "$.symbols",
        parameters: {
          "symbolItem.$": "$$.Map.Item.Value",
          "APIKey.$": "$.APIKey"
        },
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
            aws_stepfunctions.JsonPath.stringAt("$.symbolItem.symbol")
          ),
          Price: aws_stepfunctions_tasks.DynamoAttributeValue.numberFromString(
            aws_stepfunctions.JsonPath.stringAt(
              "States.Format('{}', $.symbolItem.price.price)"
            )
          )
        }
      }
    );
    const savePrices = new aws_stepfunctions.Map(this, "SavePrices", {
      itemsPath: "$"
    }).iterator(savePriceTask);

    const machineDefinition = fetchAPIKeyAndSymbols
      .next(mapToSymbolPrices)
      .next(savePrices);

    const machine = new aws_stepfunctions.StateMachine(this, "Machine", {
      definition: machineDefinition
    });

    new aws_events.Rule(this, "Rule", {
      enabled: false,
      schedule: aws_events.Schedule.rate(Duration.minutes(1)),
      targets: [
        new aws_events_targets.SfnStateMachine(machine, {
          retryAttempts: 0
        })
      ]
    });
  }
}
class SymbolDataFetcher extends Construct {
  public api: aws_apigateway.RestApi;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.api = new aws_apigateway.RestApi(this, "API");
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
          // You might want to add support for different resolutions based on the query parameters.
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
           * These have to be hardcoded. There is no way to get the statusCode via VTL.
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

interface SymbolsPriceEventSenderProps {
  dataTable: ITable;
}
class SymbolsPriceEventSender extends Construct {
  constructor(
    scope: Construct,
    id: string,
    props: SymbolsPriceEventSenderProps
  ) {
    super(scope, id);

    const symbolsPriceDeltaEventSenderFunctionPath = join(
      __dirname,
      "../../src/functions/symbols_price_event_sender"
    );
    const symbolsPriceDeltaEventSenderFunction = new LambdaGo.GoFunction(
      this,
      "SymbolsPriceEventSenderFunction",
      {
        entry: symbolsPriceDeltaEventSenderFunctionPath,
        environment: {
          TABLE_NAME: props.dataTable.tableName
        }
      }
    );
    symbolsPriceDeltaEventSenderFunction.addToRolePolicy(
      new aws_iam.PolicyStatement({
        actions: ["events:PutEvents"],
        resources: [
          `arn:aws:events:${Aws.REGION}:${Aws.ACCOUNT_ID}:event-bus/default`
        ],
        effect: aws_iam.Effect.ALLOW
      })
    );
    props.dataTable.grantStreamRead(symbolsPriceDeltaEventSenderFunction);

    const ESM = new aws_lambda.CfnEventSourceMapping(
      this,
      "SymbolsPriceEventSenderEventSourceMapping",
      {
        functionName: symbolsPriceDeltaEventSenderFunction.functionName,
        eventSourceArn: props.dataTable.tableStreamArn,
        startingPosition: "LATEST",
        filterCriteria: {
          Filters: [
            {
              Pattern:
                '{"eventName": ["MODIFY"],"dynamodb": {"NewImage": {"PK": {"S": ["DELTA", "PRICE"]}}}}'
            }
          ]
        },
        maximumRetryAttempts: 1,
        /**
         * For simplicity sake, the batchSize is limited to 10.
         * The EventBridge `PutEvents` API has a limit of 10 events per API call.
         */
        batchSize: 10,
        functionResponseTypes: ["ReportBatchItemFailures"],
        maximumBatchingWindowInSeconds: 5
      }
    );

    const symbolsPriceEventsDispatchQueue = new aws_sqs.Queue(
      this,
      "SymbolsPriceEventsDispatchQueue"
    );

    new aws_events.Rule(this, "SymbolsPriceEventsRule", {
      // Does not work, the rule name has to adhere to a pattern
      ruleName: "wm.matuszewski@gmail.com",
      targets: [
        new aws_events_targets.SqsQueue(symbolsPriceEventsDispatchQueue, {
          message: aws_events.RuleTargetInput.fromObject({
            email: aws_events.EventField.fromPath("aws.events.rule-name"),
            event: aws_events.EventField.fromPath("$")
          })
        })
      ],
      eventPattern: {
        source: ["stockwatch"]
      }
    });

    const symbolsEventsDispatcherPath = join(
      __dirname,
      "../../src/functions/symbols_event_dispatcher"
    );
    const symbolsEventsDispatcherFunction = new LambdaGo.GoFunction(
      this,
      "SymbolsEventsDispatcherFunction",
      {
        entry: symbolsEventsDispatcherPath
      }
    );
    symbolsEventsDispatcherFunction.addEventSource(
      new aws_lambda_event_sources.SqsEventSource(
        symbolsPriceEventsDispatchQueue,
        {
          batchSize: 1,
          enabled: true
        }
      )
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
