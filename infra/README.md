# StockWatchApp

https://finnhub.io/

## Learnings

- The `Properties` for a given CFN resource does not have to only be strings. They can also be an array or other structures.

  - Having said that, I think it's better to always pass strings. In Golang it's easier to _unmarshal_ the structure rather than guess its type.

- The `Test` tab within the APIGW console is very useful. It will print all the logs that are related to a given integration execution.

  - If you are trying to debug an integration error, this is very helpful.
  - You should setup APIGW logging, but having the quick and dirty way to check them works as well.

- When creating APIGW `HTTPIntegration` you are forced to **hardcode** the returned status codes (unless you want to map every possible combination).

  - Checkout [this StackOverflow answer](https://stackoverflow.com/a/41682424) for more details.
  - I'm kind of frustrated that this is the case. I would love to create a **true** passthrough layer on top of existing HTTP endpoint using APIGW, but that does not seem to be possible

- **The VTL in the APIGW is not the same as VTL in AppSync**.

  - It looks to me that **AppSync extends the VTL language by adding many helpers**. **APIGW is also doing that** but the catch is that **what is available in AppSync might not be available in APIGW VTL**.
  - There are multiple hints regarding this in the [AppSync documentation](https://docs.aws.amazon.com/appsync/latest/devguide/resolver-context-reference.html).
    > AWS **AppSync defines** a set of variables and functions for working with resolver mapping templates. This makes logical operations on data easier with GraphQL.

- The `requestOverrides` for **_querystrings_** have to be strings. If they are not, APIGW will **silently reject the override and proceed as if you did not specify it in your VTL template**.

  - I have when tools "silently fail". It is so much better to "fail in the open".

- The **type coercion** in **VTL (APIGW) is kind of weird**.

  - If you specify a variable that is a number in quotation marks, then it will become as string.

    ```vtl
    "$context.requestTimeEpoch" // OK
    "$context.requestTimeEpoch - 60" // "123456 + - 60" // WTF :D
    ```

- With the _SDK Integrations_ we can **finally use DynamoDB `Query` operation within the _StepFunctions_**!

  - This is great news, you no longer have to write a lambda function to that operation.

- The _APIGW StepFunctions optimized_ integration **requires arrays as properties for `QueryParameters`**. It is not mentioned in the docs anywhere!

  - With the array requirement, how one can use the _JSONPath_ and the `States.Format` ?
  - Here is what I came up with:

    ```text
    "symbol.$": "States.StringToJson(States.Format('[\"{}\"]', $.symbols[0].SK.S))"

    ```

- The _APIGW StepFunctions optimized_ integration **does not support the `parameters` (_StepFunctions_) property**. This makes it hard to format the results correctly.

  - If you use `resultSelector` and `resultPath` you will end up with nested object. :C

- The `DynamoAttributeValue.fromNumber` in _StepFunctions_ is **broken**!

  - See [this issue](https://github.com/aws/aws-cdk/issues/12456) for more details

- The new _event source mappings_ filtering capabilities are not supported in L2 Lambda CDK constructs.
  - You either have to use the `CfnEventSourceMapping` or [add a manual override as per this blog post](https://medium.com/@philipzeh/event-filtering-for-lambda-functions-using-aws-cdk-d332140590f8).
  - The filtering capabilities are neat! And the supported syntax is the same as _EventBridge_.
  - You can learn a bit more about the technology behind the filtering by reading [this blog post](https://www.tbray.org/ongoing/When/202x/2021/12/03/Filtering-Lessons).
