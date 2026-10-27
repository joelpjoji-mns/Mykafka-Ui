package io.kafbat.ui.service;

import io.kafbat.ui.model.ConnectorDTO;
import io.kafbat.ui.model.ConnectorStateDTO;
import io.kafbat.ui.model.ConnectorTaskStatusDTO;
import io.kafbat.ui.model.ConnectorTriageConnectorDTO;
import io.kafbat.ui.model.ConnectorTriageSeverityDTO;
import io.kafbat.ui.model.ConnectorTriageSnapshotDTO;
import io.kafbat.ui.model.ConnectorTriageSummaryDTO;
import io.kafbat.ui.model.ConnectorTriageTaskDTO;
import io.kafbat.ui.model.KafkaCluster;
import io.kafbat.ui.model.TaskDTO;
import io.kafbat.ui.model.TaskStatusDTO;
import io.kafbat.ui.model.connect.InternalConnectorInfo;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Flux;

@Service
@RequiredArgsConstructor
public class ConnectorTriageService {
  private static final int MAX_TRACE_EXCERPT_LENGTH = 1_000;

  private final KafkaConnectService kafkaConnectService;

  public Flux<ConnectorTriageConnectorDTO> getTriage(KafkaCluster cluster) {
    return kafkaConnectService.getAllConnectorInfosWithoutTopics(cluster).map(this::toTriageConnector);
  }

  public ConnectorTriageSnapshotDTO snapshot(List<ConnectorTriageConnectorDTO> connectors) {
    int healthy = countBySeverity(connectors, ConnectorTriageSeverityDTO.HEALTHY);
    int warning = countBySeverity(connectors, ConnectorTriageSeverityDTO.WARNING);
    int critical = countBySeverity(connectors, ConnectorTriageSeverityDTO.CRITICAL);
    int failedTasks = connectors.stream()
        .mapToInt(ConnectorTriageConnectorDTO::getFailedTasksCount)
        .sum();

    return new ConnectorTriageSnapshotDTO()
        .collectedAtMs(System.currentTimeMillis())
        .summary(new ConnectorTriageSummaryDTO()
            .totalConnectors(connectors.size())
            .healthyConnectors(healthy)
            .warningConnectors(warning)
            .criticalConnectors(critical)
            .failedTasks(failedTasks))
        .connectors(connectors);
  }

  ConnectorTriageConnectorDTO toTriageConnector(InternalConnectorInfo connectorInfo) {
    ConnectorDTO connector = connectorInfo.getConnector();
    List<TaskDTO> tasks = connectorInfo.getTasks() == null ? List.of() : connectorInfo.getTasks();
    List<ConnectorTriageTaskDTO> failedTasks = tasks.stream()
        .filter(this::isFailed)
        .filter(task -> task.getId() != null && task.getId().getTask() != null)
        .map(this::toTriageTask)
        .toList();
    int failedTasksCount = (int) tasks.stream().filter(this::isFailed).count();
    ConnectorStateDTO connectorState = connectorState(connector);

    return new ConnectorTriageConnectorDTO()
        .connect(connector.getConnect())
        .name(connector.getName())
        .connectorState(connectorState)
        .severity(severity(connectorState, failedTasksCount))
        .tasksCount(tasks.size())
        .failedTasksCount(failedTasksCount)
        .failedTasks(failedTasks)
        .traceExcerpt(traceExcerpt(connector.getStatus() == null
            ? null
            : connector.getStatus().getTrace()));
  }

  private ConnectorTriageTaskDTO toTriageTask(TaskDTO task) {
    TaskStatusDTO status = task.getStatus();
    return new ConnectorTriageTaskDTO()
        .id(task.getId().getTask())
        .state(taskState(task))
        .traceExcerpt(traceExcerpt(status == null ? null : status.getTrace()));
  }

  private int countBySeverity(List<ConnectorTriageConnectorDTO> connectors,
                              ConnectorTriageSeverityDTO severity) {
    return (int) connectors.stream().filter(connector -> connector.getSeverity() == severity).count();
  }

  private boolean isFailed(TaskDTO task) {
    return taskState(task) == ConnectorTaskStatusDTO.FAILED;
  }

  private ConnectorStateDTO connectorState(ConnectorDTO connector) {
    if (connector.getStatus() == null || connector.getStatus().getState() == null) {
      return ConnectorStateDTO.UNASSIGNED;
    }
    return connector.getStatus().getState();
  }

  private ConnectorTaskStatusDTO taskState(TaskDTO task) {
    if (task.getStatus() == null || task.getStatus().getState() == null) {
      return ConnectorTaskStatusDTO.UNASSIGNED;
    }
    return task.getStatus().getState();
  }

  private ConnectorTriageSeverityDTO severity(ConnectorStateDTO state, int failedTasksCount) {
    if (failedTasksCount > 0
        || state == ConnectorStateDTO.FAILED
        || state == ConnectorStateDTO.TASK_FAILED) {
      return ConnectorTriageSeverityDTO.CRITICAL;
    }
    if (state == ConnectorStateDTO.RESTARTING
        || state == ConnectorStateDTO.UNASSIGNED
        || state == ConnectorStateDTO.STOPPED) {
      return ConnectorTriageSeverityDTO.WARNING;
    }
    return ConnectorTriageSeverityDTO.HEALTHY;
  }

  private String traceExcerpt(String trace) {
    if (trace == null || trace.isBlank()) {
      return null;
    }
    String excerpt = trace.trim();
    return excerpt.length() <= MAX_TRACE_EXCERPT_LENGTH
        ? excerpt
        : excerpt.substring(0, MAX_TRACE_EXCERPT_LENGTH) + "...";
  }
}