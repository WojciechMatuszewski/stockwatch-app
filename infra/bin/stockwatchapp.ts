import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { StockWatchAppStack } from "../lib/stockwatchapp-stack";

const app = new cdk.App();
new StockWatchAppStack(app, "StockWatchApp");
