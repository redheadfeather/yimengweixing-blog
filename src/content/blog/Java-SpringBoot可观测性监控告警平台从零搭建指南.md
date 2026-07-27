---
title: 'Java Spring Boot 可观测性监控告警平台从零搭建指南'
description: '面向 Java 后端工程师的 Prometheus、Alertmanager、Grafana、Loki 与 Grafana Alloy 实战手册。'
pubDate: '2026-07-27'
tags: ['Java', 'Spring Boot', '可观测性']
---

> 面向 Java 后端工程师的 Prometheus、Alertmanager、Grafana、Loki 与 Grafana Alloy 实战手册

## 1. 文档目标

本文帮助一名具备 Spring Boot 基础、但没有监控平台经验的 Java 后端工程师，从零搭建一套包含指标、日志、可视化和告警通知的可观测性平台，并理解每个组件为什么存在、每项配置解决什么问题。

全文分为两条落地路径：

1. 使用 Docker Compose 在 Windows/Linux 上搭建单机可运行环境，用于开发、验证和中小规模内部环境。
2. 将同一套设计迁移到 Kubernetes，使用 Prometheus Operator、ServiceMonitor、PrometheusRule 和 AlertmanagerConfig 管理生产配置。

本文对应的本地示例项目使用 Java 21、Spring Boot 3.5.14、Prometheus 3.12.0、Alertmanager 0.32.1、Loki 3.7.2、Grafana Alloy 1.16.1 和 Grafana 13.1.0。版本应固定并经过升级测试，不要在生产环境直接使用 `latest`。

## 2. 先理解平台解决什么问题

应用出现故障时，通常需要回答四类问题：

- 服务是否存活，流量和错误率是否异常？
- JVM Heap、GC、线程和 CPU 是否异常？
- 哪个业务接口或业务流程出了问题？
- 对应时刻的日志和异常堆栈是什么？

指标擅长回答“发生了多少、持续多久、趋势如何”；日志擅长回答“具体发生了什么”。完整平台必须同时建设两条链路。

```text
指标链路：
Spring Boot → Micrometer → /actuator/prometheus
            → Prometheus → PromQL → Grafana
            → 告警规则 → Alertmanager → 邮件/企业微信/钉钉/Webhook

日志链路：
Spring Boot JSON 日志 → Alloy → Loki → LogQL → Grafana
```

不要把日志全部转换成指标，也不要试图只靠指标替代日志。订单 ID、用户 ID、异常堆栈适合进入日志；成功率、P95 延迟、积压数量适合成为指标。

## 3. 每个组件的职责

| 组件 | 核心职责 | 不负责什么 |
|---|---|---|
| Spring Boot Actuator | 暴露健康状态和 Prometheus 格式指标 | 不保存历史指标 |
| Micrometer | 在 Java 中统一定义 Counter、Gauge、Timer 等指标 | 不负责持久化和告警通知 |
| Prometheus | 定时抓取、存储时间序列、执行 PromQL 和规则 | 不适合存储日志正文 |
| Alertmanager | 告警去重、分组、路由、抑制、静默和通知 | 不计算告警表达式 |
| Alloy | 发现、读取、解析、添加标签并转发日志 | 不负责长期日志查询 |
| Loki | 存储日志并提供 LogQL 查询 | 不直接读取宿主机日志文件 |
| Grafana | 查询 Prometheus/Loki 并展示仪表盘 | 不是指标或日志的权威存储 |

关键边界是：Prometheus 决定“是否满足告警条件”，Alertmanager 决定“相同告警怎样合并、发给谁、何时重复发送”。

## 4. 目录结构

建议把监控配置与业务代码一起纳入 Git：

```text
project/
├── pom.xml
├── src/main/java/...
├── src/main/resources/application.yml
├── logs/
├── monitoring/
│   ├── docker-compose.yml
│   ├── prometheus/
│   │   ├── prometheus.yml
│   │   └── rules/
│   │       ├── java-alerts.yml
│   │       └── business-alerts.yml
│   ├── alertmanager/
│   │   ├── alertmanager.yml
│   │   └── templates/
│   ├── alloy/config.alloy
│   ├── loki/loki.yml
│   └── grafana/
│       ├── provisioning/datasources/datasources.yml
│       ├── provisioning/dashboards/dashboards.yml
│       └── dashboards/java-monitoring.json
└── scripts/
```

这样做的原因是：指标、规则、仪表盘和业务版本可以一起评审、回滚和发布，避免只能在 UI 中人工维护。

### 4.1 配置文件职责速查

| 文件 | 归属组件 | 作用 | 修改时机 |
|---|---|---|---|
| `pom.xml` | Spring Boot | 引入 Actuator 和 Prometheus Registry | 首次接入或升级依赖 |
| `application.yml` | Spring Boot | 暴露端点、公共标签、日志格式和滚动策略 | 应用、环境、安全或日志策略变化 |
| `monitoring/docker-compose.yml` | Docker Compose | 定义镜像、网络、端口、挂载、数据卷和依赖 | 新增组件、升级版本或调整资源 |
| `prometheus/prometheus.yml` | Prometheus | 定义抓取周期、目标、规则文件和 Alertmanager 地址 | 新增应用或修改抓取方式 |
| `prometheus/rules/*.yml` | Prometheus | 定义 recording rules 和 alerting rules | 增加告警或根据基线调阈值 |
| `alertmanager/alertmanager.yml` | Alertmanager | 定义分组、路由、抑制、时间窗口和接收器 | 调整团队、渠道或值班策略 |
| `alloy/config.alloy` | Alloy | 定义日志发现、读取、解析、标签和发送地址 | 日志路径、格式或后端变化 |
| `loki/loki.yml` | Loki | 定义端口、索引、存储和保留策略 | 调整存储、保留或生产拓扑 |
| `grafana/provisioning/*.yml` | Grafana | 自动创建数据源并加载仪表盘 | 数据源或加载策略变化 |
| `grafana/dashboards/*.json` | Grafana | 定义面板、查询、布局、单位和阈值 | 增加面板或优化排障视图 |

配置变更应先做语法检查和端到端验证，再通过 Git 发布；不要直接进入容器修改，因为容器重建后会丢失且无法审计。


## 5. Spring Boot 接入指标

### 5.1 Maven 依赖

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-actuator</artifactId>
</dependency>
<dependency>
    <groupId>io.micrometer</groupId>
    <artifactId>micrometer-registry-prometheus</artifactId>
    <scope>runtime</scope>
</dependency>
```

Actuator 提供管理端点和自动指标，Prometheus Registry 把 Micrometer 指标转换成 Prometheus 可抓取格式。Spring Boot 官方说明 `/actuator/prometheus` 是 Prometheus 的 scrape endpoint，且需要 `micrometer-registry-prometheus` 依赖：[Spring Boot Metrics](https://docs.spring.io/spring-boot/reference/actuator/metrics.html)。

### 5.2 application.yml

```yaml
spring:
  application:
    name: order-service

management:
  prometheus:
    metrics:
      export:
        enabled: true
  endpoints:
    web:
      exposure:
        include: health,info,prometheus
  endpoint:
    prometheus:
      access: read-only
  metrics:
    tags:
      application: ${spring.application.name}
      environment: ${APP_ENV:local}
```

配置说明：

- `export.enabled`：启用 Prometheus Registry 输出。
- `exposure.include`：只通过 HTTP 暴露必要端点。不要为了方便暴露 `env`、`heapdump`、`configprops` 和 `threaddump`。
- `access: read-only`：Prometheus 端点只读。
- 公共标签 `application`、`environment`：让多应用、多环境数据可以被筛选和聚合。

生产环境建议使用独立管理端口、网络策略、TLS 和认证保护 Actuator。`health` 是否显示详细依赖状态也应按安全要求控制。

### 5.3 自动获得的指标

接入后通常可以获得：

- JVM 内存：`jvm_memory_used_bytes`、`jvm_memory_max_bytes`。
- GC：`jvm_gc_pause_seconds_count/sum/max`、`jvm_gc_overhead`。
- 线程：`jvm_threads_live_threads`、`jvm_threads_states_threads`。
- 进程：`process_cpu_usage`、`process_uptime_seconds`。
- HTTP：`http_server_requests_seconds_count/sum/max`。
- Tomcat 与执行器：Session、线程池和队列指标。
- 日志计数：`logback_events_total`。

先验证端点：

```bash
curl http://localhost:8080/actuator/prometheus
```

如果端点返回 404，依次检查依赖、端点暴露范围和 Registry 是否启用。

## 6. 自定义业务指标

### 6.1 先设计再编码

指标应回答具体业务问题：

| 问题 | 类型 | Micrometer 名称 | Prometheus 名称 |
|---|---|---|---|
| 创建订单成功/失败多少次 | Counter | `business.orders.created` | `business_orders_created_total` |
| 创建订单用了多久 | Timer | `business.orders.create.duration` | `business_orders_create_duration_seconds_*` |
| 当前待处理订单数 | Gauge | `business.orders.pending` | `business_orders_pending` |
| 订单金额分布 | DistributionSummary | `business.orders.amount` | `business_orders_amount_*` |

Counter 只增不减；Gauge 表示可升可降的当前值；Timer 记录次数与时间分布；DistributionSummary 记录非时间数值分布。Micrometer 提供这些厂商无关的接口：[Micrometer Reference](https://docs.micrometer.io/micrometer/reference/)。

### 6.2 集中封装业务指标

```java
package com.example.order.metrics;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.DistributionSummary;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * 集中管理订单领域指标，避免指标名称和标签散落在业务代码中。
 */
@Component
public class OrderMetrics {

    private final Counter successCounter;
    private final Counter failureCounter;
    private final Timer createTimer;
    private final DistributionSummary amountSummary;
    private final AtomicInteger pending = new AtomicInteger();

    public OrderMetrics(MeterRegistry registry) {
        successCounter = Counter.builder("business.orders.created")
                .description("订单创建次数")
                .tag("result", "success")
                .register(registry);

        failureCounter = Counter.builder("business.orders.created")
                .description("订单创建次数")
                .tag("result", "failure")
                .register(registry);

        createTimer = Timer.builder("business.orders.create.duration")
                .description("订单创建耗时")
                .publishPercentileHistogram()
                .serviceLevelObjectives(
                        Duration.ofMillis(100),
                        Duration.ofMillis(500),
                        Duration.ofSeconds(1),
                        Duration.ofSeconds(3))
                .register(registry);

        amountSummary = DistributionSummary.builder("business.orders.amount")
                .description("订单金额分布")
                .baseUnit("fen")
                .serviceLevelObjectives(10_000, 50_000, 100_000, 500_000)
                .register(registry);

        Gauge.builder("business.orders.pending", pending, AtomicInteger::get)
                .description("当前待处理订单数量")
                .register(registry);
    }

    public Timer.Sample startCreate(MeterRegistry registry) {
        return Timer.start(registry);
    }

    public void success(Timer.Sample sample, long amountFen) {
        sample.stop(createTimer);
        successCounter.increment();
        amountSummary.record(amountFen);
        pending.incrementAndGet();
    }

    public void failure(Timer.Sample sample) {
        sample.stop(createTimer);
        failureCounter.increment();
    }

    public void completed() {
        pending.updateAndGet(value -> Math.max(0, value - 1));
    }
}
```

业务 Service 在真实结果确定的位置记录：

```java
public Order create(CreateOrderCommand command) {
    Timer.Sample sample = metrics.startCreate(meterRegistry);
    try {
        Order order = repository.save(toOrder(command));
        metrics.success(sample, order.getAmountFen());
        return order;
    } catch (RuntimeException exception) {
        metrics.failure(sample);
        throw exception;
    }
}
```

不要仅因为 Controller 返回 200 就记录业务成功；应在数据库提交或业务状态真正成功后记录。

### 6.3 标签与高基数

可以使用有限枚举标签：

```text
result=success|failure
channel=web|app|admin
payment_method=wechat|alipay|card
```

禁止把订单 ID、用户 ID、手机号、IP、完整 URL、异常消息或时间戳作为标签。每一种标签值组合都会生成新时间序列，动态标签会快速消耗 Prometheus 内存、CPU 和磁盘。Prometheus 官方也明确反对将用户 ID、邮箱等无界集合放入标签：[Metric and label naming](https://prometheus.io/docs/practices/naming/)。这些详细字段应写入日志。

### 6.4 验证自定义指标被采集

第一层，确认应用已经注册并暴露：

```bash
curl -s http://localhost:8080/actuator/prometheus | grep business_orders
```

第二层，确认 Prometheus target 为 UP：

```promql
up{job="spring-boot"}
```

第三层，查询自定义指标：

```promql
business_orders_created_total{job="spring-boot"}
```

如果第一层有、第三层没有，问题通常在 `metrics_path`、target 地址、网络或 Prometheus 最近一次抓取错误。查看 `http://localhost:9090/targets` 的 `Last scrape` 和 `Last error`。

### 6.5 自定义指标测试

使用 `SimpleMeterRegistry` 做单元测试：

```java
@Test
void shouldRecordSuccessfulOrder() {
    SimpleMeterRegistry registry = new SimpleMeterRegistry();
    OrderMetrics metrics = new OrderMetrics(registry);

    Timer.Sample sample = metrics.startCreate(registry);
    metrics.success(sample, 12_800);

    assertThat(registry.get("business.orders.created")
            .tag("result", "success").counter().count()).isEqualTo(1.0);
    assertThat(registry.get("business.orders.pending").gauge().value())
            .isEqualTo(1.0);
}
```

集成测试还应请求 `/actuator/prometheus`，断言转换后的 Prometheus 名称存在。

## 7. Prometheus 配置

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

rule_files:
  - /etc/prometheus/rules/*.yml

alerting:
  alertmanagers:
    - static_configs:
        - targets: ["alertmanager:9093"]

scrape_configs:
  - job_name: spring-boot
    metrics_path: /actuator/prometheus
    static_configs:
      - targets: ["host.docker.internal:8080"]
        labels:
          environment: local
```

配置项说明：

- `scrape_interval`：每隔多久拉取一次指标。越短越及时，但网络、存储和 CPU 成本越高。
- `evaluation_interval`：多长时间计算一次 recording/alerting rules。
- `rule_files`：加载规则文件的 glob。
- `alerting.alertmanagers`：把 firing 告警发送到哪个 Alertmanager。
- `job_name`：一组同类 target 的稳定逻辑名称。
- `metrics_path`：Spring Boot 的 Prometheus 端点。
- `targets`：实际抓取地址。

Compose 服务名如 `alertmanager`、`loki` 能直接作为主机名，是因为同一个 Compose 网络内有 Docker DNS。宿主机应用则使用 `host.docker.internal`。Prometheus 官方配置文档说明配置文件负责抓取任务、实例和规则加载，并支持在启用 lifecycle 后通过 `POST /-/reload` 热加载：[Prometheus configuration](https://prometheus.io/docs/prometheus/latest/configuration/configuration/)。

修改配置前后执行：

```bash
promtool check config prometheus.yml
promtool check rules rules/*.yml
curl -X POST http://localhost:9090/-/reload
```

## 8. 告警规则设计

### 8.1 基础 Java 告警

```yaml
groups:
  - name: java-service
    rules:
      - alert: SpringBootApplicationDown
        expr: up{job="spring-boot"} == 0
        for: 1m
        labels:
          severity: critical
          team: backend
        annotations:
          summary: "Spring Boot 应用不可访问"
          description: "Prometheus 连续一分钟无法抓取 {{ $labels.instance }}。"
          runbook_url: "https://wiki.example.com/runbooks/app-down"

      - alert: JvmHeapUsageHigh
        expr: |
          sum by(instance) (jvm_memory_used_bytes{job="spring-boot",area="heap"})
          /
          sum by(instance) (jvm_memory_max_bytes{job="spring-boot",area="heap"})
          > 0.80
        for: 10m
        labels:
          severity: warning
          team: backend
        annotations:
          summary: "JVM Heap 使用率持续超过 80%"
```

`for` 避免瞬时抖动直接通知；`labels` 用于路由；`annotations` 用于人读信息、仪表盘和 Runbook 链接。Prometheus 将持续满足 `for` 但尚未到期的告警标记为 pending，到期后才 firing：[Alerting rules](https://prometheus.io/docs/prometheus/3.5/configuration/alerting_rules/)。

阈值不能机械照抄。生产环境应先观察基线，再结合 JVM 最大堆、流量周期和用户影响设定。优先对错误率、延迟、可用性等用户症状告警，而不是对每个内部原因都发通知。

### 8.2 业务告警

订单失败率：

```yaml
- alert: OrderCreateFailureRateHigh
  expr: |
    sum(rate(business_orders_created_total{result="failure"}[5m]))
    /
    clamp_min(sum(rate(business_orders_created_total[5m])), 0.001)
    > 0.10
  for: 5m
  labels:
    severity: critical
    team: order
  annotations:
    summary: "订单创建失败率超过 10%"
```

P95 延迟：

```promql
histogram_quantile(
  0.95,
  sum by(le) (
    rate(business_orders_create_duration_seconds_bucket[5m])
  )
)
```

使用 Histogram 的原因是 bucket 可以跨实例聚合，随后由 Prometheus 计算分位数。经典 Histogram 的 `histogram_quantile` 聚合必须保留 `le` 标签：[Prometheus query functions](https://prometheus.io/docs/prometheus/3.5/querying/functions/)。

待处理积压：

```yaml
- alert: PendingOrdersHigh
  expr: sum(business_orders_pending) > 100
  for: 10m
  labels:
    severity: warning
    team: order
  annotations:
    summary: "待处理订单持续积压"
```

每条可行动告警都应包含负责人、严重级别、症状、影响、仪表盘和 Runbook。

## 9. Alertmanager 配置与实际通知

### 9.1 路由、分组和重复通知

```yaml
global:
  resolve_timeout: 5m

route:
  receiver: default-email
  group_by: [alertname, application, environment]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  routes:
    - matchers:
        - severity="critical"
      receiver: critical-webhook
      repeat_interval: 30m
    - matchers:
        - team="order"
      receiver: order-team

receivers:
  - name: default-email
  - name: critical-webhook
  - name: order-team
```

- `receiver`：默认接收器。
- `group_by`：具有相同标签的告警合并成一条通知。
- `group_wait`：第一个告警出现后等待一段时间，以收集同组告警。
- `group_interval`：同一组新增或恢复告警后，两次通知之间的最小间隔。
- `repeat_interval`：同一 firing 告警多久提醒一次。
- 子 `routes`：按 `severity`、`team`、`environment` 路由。

Alertmanager 的核心能力正是去重、分组和路由：[Alertmanager overview](https://prometheus.io/docs/alerting/latest/alertmanager/)。

### 9.2 邮件

```yaml
global:
  smtp_smarthost: "smtp.example.com:465"
  smtp_from: "monitor@example.com"
  smtp_auth_username: "monitor@example.com"
  smtp_auth_password: "__INJECT_AT_DEPLOY_TIME__"
  smtp_require_tls: true

receivers:
  - name: default-email
    email_configs:
      - to: "backend-oncall@example.com"
        send_resolved: true
        headers:
          subject: "[{{ .Status | toUpper }}] {{ .CommonLabels.alertname }}"
```

不同 SMTP 服务商对 465 隐式 TLS、587 STARTTLS、授权码和 From 地址有不同要求。先用测试邮箱验证 firing 与 resolved 两种消息。

### 9.3 通用 Webhook

```yaml
receivers:
  - name: critical-webhook
    webhook_configs:
      - url: "http://notification-adapter:8080/alertmanager"
        send_resolved: true
        max_alerts: 20
        timeout: 10s
```

Alertmanager 会 POST 一个包含 `status`、`groupLabels`、`commonLabels` 和 `alerts` 数组的 JSON。Webhook 接收端必须实现鉴权、幂等、超时、重试可见性和日志。官方配置格式见：[Alertmanager configuration](https://prometheus.io/docs/alerting/latest/configuration/)。

### 9.4 企业微信

Alertmanager 原生 `wechat_configs` 对接的是企业微信应用消息，需要企业 ID、应用 Agent ID 和应用 Secret：

```yaml
global:
  wechat_api_url: "https://qyapi.weixin.qq.com/cgi-bin/"
  wechat_api_corp_id: "__CORP_ID__"
  wechat_api_secret: "__APP_SECRET__"

receivers:
  - name: order-team
    wechat_configs:
      - agent_id: "1000002"
        to_party: "2"
        send_resolved: true
        message: |-
          {{ range .Alerts }}
          [{{ .Status }}] {{ .Annotations.summary }}
          实例：{{ .Labels.instance }}
          {{ end }}
```

如果使用“企业微信群机器人 Webhook”，其请求体格式与 Alertmanager 通用 Webhook 不同，应增加一个通知适配器，把 Alertmanager JSON 转换成机器人要求的 `text`/`markdown` JSON，不要假设 URL 直连即可工作。

### 9.5 钉钉群机器人

钉钉同样需要格式适配。常见做法是部署经过安全评估并固定版本的 `prometheus-webhook-dingtalk`，或者由团队维护统一通知网关：

```yaml
receivers:
  - name: dingtalk-order
    webhook_configs:
      - url: "http://dingtalk-adapter:8060/dingtalk/order/send"
        send_resolved: true
```

适配器再持有钉钉机器人 access token 和签名密钥。密钥不要放在 Git、镜像、Grafana 面板或告警 annotation 中。

### 9.6 Secret 管理

Alertmanager 配置文件不是通用 shell 模板，不能默认假设 `${PASSWORD}` 会自动展开。可采用：

- CI/CD 在部署时从密钥系统渲染配置。
- Docker Secret/Kubernetes Secret 以文件挂载，优先使用配置项提供的 `*_file`/`url_file` 能力。
- 使用 Vault、云 Secret Manager 或统一通知网关隔离真实密钥。

渲染后的文件应限制权限，日志中不得输出完整 Webhook URL。

### 9.7 抑制与静默

当服务整体 Down 时，可以抑制同一实例的次级告警：

```yaml
inhibit_rules:
  - source_matchers:
      - alertname="SpringBootApplicationDown"
    target_matchers:
      - severity=~"warning|info"
    equal: [application, environment, instance]
```

静默（Silence）适用于有时间边界的维护窗口；不能通过删除规则或永久扩大阈值实现“临时静音”。

## 10. Spring Boot 结构化日志

```yaml
logging:
  file:
    name: logs/order-service.log
  structured:
    format:
      console: logstash
      file: logstash
  logback:
    rollingpolicy:
      max-file-size: 20MB
      max-history: 7
      total-size-cap: 200MB
```

结构化 JSON 让 Alloy 可以稳定提取时间、级别、logger 和 trace ID；滚动策略防止应用磁盘被日志占满。日志中应包含 `trace_id`、`request_id`、业务操作和错误类型，但要脱敏密码、令牌、身份证号等敏感数据。

## 11. Alloy 配置

```alloy
local.file_match "spring_boot_logs" {
  path_targets = [{
    "__path__"    = "/var/log/order-service/*.log",
    "job"         = "spring-boot",
    "application" = "order-service",
    "environment" = "prod",
  }]
}

loki.source.file "spring_boot_logs" {
  targets    = local.file_match.spring_boot_logs.targets
  forward_to = [loki.process.spring_boot_logs.receiver]
}

loki.process "spring_boot_logs" {
  stage.json {
    expressions = {
      level    = "level",
      trace_id = "trace_id",
    }
  }
  stage.labels {
    values = { level = "" }
  }
  stage.structured_metadata {
    values = { trace_id = "" }
  }
  forward_to = [loki.write.local.receiver]
}

loki.write "local" {
  endpoint {
    url = "http://loki:3100/loki/api/v1/push"
  }
}
```

- `local.file_match`：发现匹配日志文件并附加静态标签。
- `loki.source.file`：持续读取新增行，并保存读取位置。
- `loki.process`：按顺序解析和加工日志。
- `stage.labels`：把低基数字段变成 Loki 索引标签。
- `stage.structured_metadata`：保留 trace ID 等高基数元数据，但不作为索引标签。
- `loki.write`：推送到 Loki API。

Alloy 官方文档说明 `loki.source.file` 读取文件并把新日志转发给下游组件：[loki.source.file](https://grafana.com/docs/alloy/latest/reference/components/loki/loki.source.file/)。不要把 `logger_name`、用户 ID、订单 ID 和 trace ID全部变成 Loki 标签，否则同样会发生高基数问题。

## 12. Loki 配置

单机开发配置：

```yaml
auth_enabled: false

server:
  http_listen_port: 3100

common:
  path_prefix: /loki
  replication_factor: 1
  storage:
    filesystem:
      chunks_directory: /loki/chunks
      rules_directory: /loki/rules

schema_config:
  configs:
    - from: 2024-01-01
      store: tsdb
      object_store: filesystem
      schema: v13
      index:
        prefix: index_
        period: 24h

limits_config:
  retention_period: 168h

compactor:
  working_directory: /loki/compactor
  retention_enabled: true
  delete_request_store: filesystem
```

- `auth_enabled: false`：只适用于隔离的单租户开发环境。
- `path_prefix`：Loki 本地数据根目录。
- `replication_factor: 1`：单副本，没有高可用。
- `store: tsdb`：使用 Loki 推荐的 TSDB 索引。
- `object_store: filesystem`：简单但无副本，磁盘损坏会丢数据。
- `retention_period`：保留七天。
- `compactor.retention_enabled`：由 Compactor 执行保留策略。

Grafana 官方说明 filesystem 适合单机和本地开发，但没有复制保护；生产环境应使用 S3、GCS、Azure Blob、OSS 或兼容 S3 的对象存储：[Loki storage](https://grafana.com/docs/loki/latest/configure/storage/)。

常用 LogQL：

```logql
{application="order-service"}
{application="order-service",level="ERROR"}
{application="order-service"} |= "Exception"
{application="order-service"} | json | trace_id="abc123"
sum(rate({application="order-service",level="ERROR"}[5m]))
```

## 13. Grafana 配置即代码

数据源：

```yaml
apiVersion: 1
datasources:
  - name: Prometheus
    uid: prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
    editable: false
  - name: Loki
    uid: loki
    type: loki
    access: proxy
    url: http://loki:3100
    editable: false
```

`access: proxy` 表示浏览器请求先到 Grafana 后端，再由 Grafana 访问容器网络中的数据源。`uid` 是仪表盘引用数据源的稳定标识。

仪表盘 Provider：

```yaml
apiVersion: 1
providers:
  - name: Java监控
    folder: Java监控
    type: file
    disableDeletion: true
    updateIntervalSeconds: 10
    options:
      path: /var/lib/grafana/dashboards
```

仪表盘 JSON 中最重要的是：

- `panels`：所有面板。
- `datasource`：Prometheus 或 Loki UID。
- `targets[].expr`：PromQL/LogQL。
- `fieldConfig`：单位、上下限和显示阈值。
- `gridPos`：24 列网格中的位置和大小。
- `refresh`：页面刷新周期。
- `time`：默认时间范围。
- `uid`：仪表盘稳定地址。

文件 Provisioning 让数据源和仪表盘可以进入版本控制；Grafana 官方提示，Provisioning 源后续更新可能覆盖 UI 中保存的版本，因此正式修改应回写 JSON：[Grafana provisioning](https://grafana.com/docs/grafana/latest/administration/provisioning/)。

推荐仪表盘至少包含：应用 UP、请求速率、错误率、P50/P95/P99、Heap、GC、CPU、线程、业务成功率、业务积压和关联日志。

## 14. Docker Compose 部署

核心原则：配置只读挂载，数据使用命名卷，管理端口只绑定 `127.0.0.1`，镜像固定版本。

```yaml
services:
  prometheus:
    image: prom/prometheus:v3.12.0
    command:
      - --config.file=/etc/prometheus/prometheus.yml
      - --storage.tsdb.path=/prometheus
      - --web.enable-lifecycle
    ports:
      - "127.0.0.1:9090:9090"
    extra_hosts:
      - "host.docker.internal:host-gateway"
    volumes:
      - ./prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - ./prometheus/rules:/etc/prometheus/rules:ro
      - prometheus-data:/prometheus

  alertmanager:
    image: prom/alertmanager:v0.32.1
    ports:
      - "127.0.0.1:9093:9093"
    volumes:
      - ./alertmanager/alertmanager.yml:/etc/alertmanager/alertmanager.yml:ro
      - alertmanager-data:/alertmanager

  loki:
    image: grafana/loki:3.7.2
    ports:
      - "127.0.0.1:3100:3100"

  alloy:
    image: grafana/alloy:v1.16.1
    volumes:
      - ./alloy/config.alloy:/etc/alloy/config.alloy:ro
      - ../logs:/var/log/order-service:ro
      - alloy-data:/var/lib/alloy/data

  grafana:
    image: grafana/grafana:13.1.0
    ports:
      - "127.0.0.1:3001:3000"
    volumes:
      - ./grafana/provisioning:/etc/grafana/provisioning:ro
      - ./grafana/dashboards:/var/lib/grafana/dashboards:ro
      - grafana-data:/var/lib/grafana
```

数据卷的作用：Prometheus 保存 TSDB，Alertmanager 保存静默等状态，Loki 保存日志，Alloy 保存读取位置，Grafana 保存用户和 UI 状态。日常 `docker compose down` 不应附加 `--volumes`，否则会删除数据卷。

启动顺序：

```bash
# 1. 启动并验证 Spring Boot
curl http://localhost:8080/actuator/health

# 2. 启动监控栈
docker compose -f monitoring/docker-compose.yml up -d

# 3. 检查容器和目标
docker compose -f monitoring/docker-compose.yml ps
curl http://localhost:9090/-/ready
curl http://localhost:3100/ready
```

## 15. 端到端验收与故障演练

### 15.1 指标链路

1. `/actuator/prometheus` 中存在 JVM 和业务指标。
2. Prometheus `/targets` 中 `spring-boot` 为 UP。
3. PromQL 能查到数据。
4. Grafana 面板能显示相同数据。

### 15.2 日志链路

1. 应用日志文件持续写入合法 JSON。
2. Alloy `/ready` 正常且没有 push 错误。
3. Loki `/ready` 返回 200。
4. Grafana Explore 中 `{application="order-service"}` 有结果。

### 15.3 告警链路

建议保留一个无停机测试告警，通过受控 500 或专用低基数测试 Counter 触发，并带上：

```yaml
labels:
  severity: info
  test: "true"
```

验收必须覆盖 pending、firing、Alertmanager active、通知发送和 resolved 恢复。生产环境不要公开任意制造 CPU、内存或异常的测试端点；测试端点必须受认证、网络隔离或只存在于非生产 profile。

## 16. 常见故障排查

### Prometheus target DOWN

- 宿主机应用是否监听 Docker 可访问的地址，而不是只监听 `127.0.0.1`？
- `host.docker.internal` 或容器服务名是否解析？
- `metrics_path` 是否为 `/actuator/prometheus`？
- 防火墙、NetworkPolicy 和认证是否允许访问？

### Alertmanager 页面没有告警

- Prometheus `/alerts` 中规则是否 inactive、pending 或 firing？
- 规则是否满足 `for` 持续时间？
- Prometheus 是否配置了 Alertmanager target？
- Alertmanager 只展示收到的活动告警，不展示所有 inactive 规则。

### Grafana 没有日志

- 应用是否真的写入 Alloy 挂载的目录？
- 文件是否为一行一个 JSON 事件？
- Alloy 是否保存了 position，是否有权限读取？
- Loki 标签查询是否与 Alloy 添加的标签完全一致？

### 自定义指标没有出现

- 指标是否在代码路径执行前已经注册？
- Counter 是否从未被调用，Gauge 引用对象是否被回收？
- 指标是否被 `MeterFilter` 禁用？
- 应用端有而 Prometheus 没有时，重点检查 target 和最近抓取错误。

### 告警通知没有发送

- receiver 是否被 route 实际选中？
- `group_wait` 是否尚未结束？
- SMTP/Webhook 网络和 TLS 是否可达？
- 适配器是否接受 Alertmanager 的 JSON？
- 查看 Alertmanager 自身日志和通知失败指标。

## 17. 生产环境设计

单机 Compose 是学习和验证方案，不等于完善的生产架构。生产至少考虑：

- Prometheus 双副本；需要长时存储时评估 Thanos/Mimir 等方案。
- Alertmanager 集群，避免通知单点。
- Loki 使用对象存储、合理副本和容量规划。
- Grafana 使用企业认证、最小权限和数据库备份。
- 所有管理端点经过 TLS、认证、网络策略或反向代理保护。
- 指标、日志、告警规则、仪表盘和 Runbook 纳入 GitOps。
- 监控系统也要监控自身：抓取失败、规则失败、通知失败、磁盘、日志拒绝和查询延迟。
- 建立容量预算：活跃时间序列数、采样间隔、保留周期、日志日增量和对象存储成本。
- 建立升级流程：测试环境验证配置兼容性、数据迁移和回滚。

## 18. Kubernetes 迁移

推荐使用 Prometheus Operator。它通过 CRD 管理 Prometheus、Alertmanager、ServiceMonitor、PodMonitor、PrometheusRule 和 AlertmanagerConfig：[Prometheus Operator Introduction](https://prometheus-operator.dev/docs/getting-started/introduction/)。

### 18.1 Service 与 ServiceMonitor

```yaml
apiVersion: v1
kind: Service
metadata:
  name: order-service
  labels:
    app: order-service
spec:
  selector:
    app: order-service
  ports:
    - name: management
      port: 8080
      targetPort: 8080
---
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: order-service
  labels:
    release: monitoring
spec:
  selector:
    matchLabels:
      app: order-service
  endpoints:
    - port: management
      path: /actuator/prometheus
      interval: 30s
```

ServiceMonitor 选择 Service，Prometheus 实例再通过 `serviceMonitorSelector` 选择 ServiceMonitor。标签不匹配是 Kubernetes 中最常见的“资源存在但没有被抓取”原因。官方示例见：[Using ServiceMonitors](https://prometheus-operator.dev/docs/developer/getting-started/)。

### 18.2 PrometheusRule

```yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: order-service-rules
  labels:
    release: monitoring
spec:
  groups:
    - name: order-service
      rules:
        - alert: OrderServiceDown
          expr: up{service="order-service"} == 0
          for: 2m
          labels:
            severity: critical
            team: order
          annotations:
            summary: "订单服务不可抓取"
```

Operator 会协调并动态加载 PrometheusRule，不需要手工进入 Pod 修改配置。

### 18.3 AlertmanagerConfig 与 Secret

通知密钥放入 Kubernetes Secret，由 AlertmanagerConfig 引用；不要把 token 写入 CRD 明文或 Helm values Git 仓库。不同 kube-prometheus-stack 版本的字段可能变化，必须以集群安装版本的 CRD schema 为准。

### 18.4 Kubernetes 日志

Alloy 使用 `loki.source.kubernetes` 或 `loki.source.podlogs` 发现 Pod 日志，不再依赖宿主机项目目录。通过 namespace、app、container 等低基数标签组织日志；对象存储承担 Loki 的持久化。

## 19. 上线检查表

### 应用

- [ ] Actuator 只暴露必要端点。
- [ ] 自定义指标有清晰名称、单位、类型和负责人。
- [ ] 没有用户 ID、订单 ID等高基数标签。
- [ ] JSON 日志脱敏并包含关联 ID。
- [ ] Heap、GC 和日志滚动参数有容量依据。

### Prometheus

- [ ] 所有 target 为 UP，抓取错误可告警。
- [ ] 配置和规则通过 `promtool`。
- [ ] 采样间隔、保留周期和磁盘容量匹配。
- [ ] 核心 PromQL 已用真实数据验证。

### Alertmanager

- [ ] 路由、分组、重复周期、抑制和静默策略清楚。
- [ ] firing 和 resolved 通知都已演练。
- [ ] 接收人、值班表、Runbook 和升级路径有效。
- [ ] 密钥未进入 Git 和日志。

### Loki/Alloy

- [ ] Alloy 可以读取日志并持久化 position。
- [ ] Loki 保留策略真实生效。
- [ ] 标签基数受控，对象存储和备份明确。

### Grafana

- [ ] 数据源和仪表盘已 Provisioning/GitOps。
- [ ] 面板单位、时间窗口、变量和阈值正确。
- [ ] 生产管理员密码已更换，登录接入统一身份认证。

## 20. 推荐实施顺序

1. 先接入 Actuator 和 Prometheus，确认默认 JVM/HTTP 指标。
2. 为一个关键业务流程增加成功数、失败数、耗时和积压指标。
3. 建立 Grafana 的流量、错误、延迟和饱和度面板。
4. 建立少量可行动告警和 Runbook。
5. 接入 Alertmanager 实际通知并做 firing/resolved 演练。
6. 输出结构化日志，使用 Alloy→Loki→Grafana 打通日志链路。
7. 建设监控系统自身监控、容量、备份、安全和高可用。
8. 迁移 Kubernetes 后用 ServiceMonitor、PrometheusRule、AlertmanagerConfig 和 Secret 实现 GitOps。

监控平台的完成标准不是“容器都启动了”，而是：业务异常能够产生可信指标，Prometheus 能抓取和计算，Grafana 能帮助定位，Alertmanager 能把可行动信息发给正确的人，日志能提供具体证据，恢复后通知能自动闭环。

