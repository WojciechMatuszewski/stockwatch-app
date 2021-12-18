import {
  aws_dynamodb,
  CustomResource,
  custom_resources,
  Stack,
  StackProps
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
  }
}

class SymbolsOrchestrator extends Construct {
  constructor(scope: Construct, id: string) {
    super(scope, id);
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

    const symbolsRegistryProvider = new custom_resources.Provider(
      this,
      "SymbolsRegistryProvider",
      {
        onEventHandler: symbolsRegistryFunction
      }
    );

    const symbols = [
      { name: "Apple", symbol: "AAPL" },
      { name: "Google", symbol: "GOOG" },
      { name: "Microsoft", symbol: "MSFT" }
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
