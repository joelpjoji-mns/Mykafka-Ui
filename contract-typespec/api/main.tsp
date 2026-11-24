// APIs
import "./clusters.tsp";
import "./brokers.tsp";
import "./topics.tsp";
import "./messages.tsp";
import "./consumer-groups.tsp";
import "./schemas.tsp";
import "./kafka-connect.tsp";
import "./ksql.tsp";
import "./acls.tsp";
import "./quotas.tsp";
import "./auth.tsp";
import "./config.tsp";
import "./graphs.tsp";
import "./prometheus.tsp";
import "./operations.tsp";
import "./audit.tsp";
import "./topic-governance.tsp";
import "./record-explorer.tsp";

import "@typespec/http";
import "@typespec/rest";
import "@typespec/openapi";

using TypeSpec.OpenAPI;
using Http;
using Rest;

@service(#{ title: "MyKafka UI API" })
@info(#{
  license: #{ name: "Apache 2.0", url: "https://www.apache.org/licenses/LICENSE-2.0.html" },
  version: "0.2.0"
})
@server("/", "Current endpoint for MyKafka UI API")
namespace Api;

