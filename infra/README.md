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
