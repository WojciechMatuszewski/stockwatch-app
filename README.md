# StockWatchApp

Inspired by [this video](https://www.youtube.com/watch?v=XoMSzGybxZg) with my own spin.

The main reason for creating this POC were:

- Learning how the new _event source mapping_ filtering works.

- Trying out the _Amazon API Gateway_ integration with _AWS Step Functions_.

## Architecture

The architecture I've built significantly differs from the one presented in the video I was inspired by. This is partly because of my learning objectives and somewhat because I favor using native integrations between services rather than _AWS Lambda_ functions.

## Learnings

- The property in the `Properties` block of a given _CloudFormation_ resource does not have only to be strings. They can also be an array or other structures.

  - Having said that, I think it's better always to pass strings. In Golang, it's easier to _unmarshal_ the structure rather than guess its type.

- The `Test` tab within the APIGW console is handy. It will print all the logs related to a given integration execution.

  - If you are trying to debug an integration error, this is very helpful.
  - You should set up _API Gateway_ logging, but having the quick and dirty way to check them works as well.

- When creating _API Gateway_ `HTTPIntegration`, you are forced to **hardcode** the returned status codes (unless you want to map every possible combination).

  - Check out [this StackOverflow answer](https://stackoverflow.com/a/41682424) for more details.

- **The VTL in the APIGW is not the same as VTL in AppSync**.

  - It looks to me that **AppSync extends the VTL language by adding many helpers**. **_API Gateway_ is also doing that**, but the catch is that **what is available in _AppSync_ might not be available in _API Gateway_ VTL**.
  - There are multiple hints regarding this in the [AppSync documentation](https://docs.aws.amazon.com/appsync/latest/devguide/resolver-context-reference.html).
    > AWS **_AppSync_ defines** a set of variables and functions for working with resolver mapping templates. This makes logical operations on data easier with GraphQL.

- The values you specify in the `requestOverrides` for **_querystrings_** have to be strings. If they are not, APIGW will **silently reject the override and proceed as if you did not specify it in your VTL template**.

  - I hate it when tools "silently fail". It is so much better to "fail in the open".

- The **type coercion** in **_API Gateway_ is weird**.

  - If you specify a variable that is a number in quotation marks, it will become a string.

    ```vtl
    "$context.requestTimeEpoch" // OK
    "$context.requestTimeEpoch - 60" // "123456 + - 60" // WTF :D
    ```

- With the _SDK Integrations_ we can **finally use DynamoDB `Query` operation within the _StepFunctions_**!

  - This is excellent news. You no longer have to write a lambda function to that operation.

- The _APIGW StepFunctions optimized_ integration **requires arrays as properties for `QueryParameters`**. It is not mentioned in the docs anywhere!

  How can one use the _JSONPath_ and the `States.Format` with the array requirement?

  - Here is what I came up with:

    ```text
    "symbol.$": "States.StringToJson(States.Format('[\"{}\"]', $.symbols[0].SK.S))"

    ```

- The _APIGW StepFunctions optimized_ integration **does not support the `parameters` (_StepFunctions_) property**. This makes it hard to format the results correctly.

  - If you use `resultSelector` and `resultPath`, you will end up with a nested object passed to your next state.

- The `DynamoAttributeValue.fromNumber` in _StepFunctions_ is **broken**!

  - See [this issue](https://github.com/aws/aws-cdk/issues/12456) for more details

- The new _event source mappings_ filtering capabilities are not supported in L2 Lambda CDK constructs.

  - You either have to use the `CfnEventSourceMapping` or [add a manual override as per this blog post](https://medium.com/@philipzeh/event-filtering-for-lambda-functions-using-aws-cdk-d332140590f8).
  - The filtering capabilities are neat! And the supported syntax is the same as _EventBridge_.
  - You can learn a bit more about the technology behind the feature by reading [this blog post](https://www.tbray.org/ongoing/When/202x/2021/12/03/Filtering-Lessons).

- The _EventBridge_ `PutEvents` API is a bit awkward to use with the `ReportBatchItemFailures` setting.

  - The response from `PutEvents` contains the `EventID` attribute, but this ID is the internal _EventBridge_ event ID, not the ID of the event you are reading from the source.
  - To monitor failed events, you can either use _DLQ_ (custom bus required) or rely on a metric that _EventBridge_ updates.
  - Note that **the _DLQ_ is set in the context of a rule, and not in the context of a bus**. This means that if the `PutEvents` call fails, you need to handle it separately from the events that are pushed to the _DLQ_.

- **The `PutRule` API call does not support adding the _target_**.

  - This is **very different from how the `AWS::Events::Rule` _CloudFormation_ resource works**. There you can specify the target along with the rule.

  - This fact makes it impossible to create a rule per given User (what I was planning to do initially. User would create a rule and then add target with their email address).
