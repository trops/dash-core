import { useState, useEffect } from "react";
import {
  SubHeading3,
  Switch,
  InputText,
  SelectInput,
  FontAwesomeIcon,
} from "@trops/dash-react";
import { ComponentManager } from "../../../../../ComponentManager";

const DAYS = [
  { key: "mon", label: "Mon" },
  { key: "tue", label: "Tue" },
  { key: "wed", label: "Wed" },
  { key: "thu", label: "Thu" },
  { key: "fri", label: "Fri" },
  { key: "sat", label: "Sat" },
  { key: "sun", label: "Sun" },
];

const INTERVAL_UNITS = [
  { value: "seconds", label: "Seconds" },
  { value: "minutes", label: "Minutes" },
  { value: "hours", label: "Hours" },
];

function intervalToMs(value, unit) {
  const num = parseInt(value, 10);
  if (isNaN(num) || num <= 0) return null;
  switch (unit) {
    case "seconds":
      return num * 1000;
    case "minutes":
      return num * 60 * 1000;
    case "hours":
      return num * 60 * 60 * 1000;
    default:
      return num * 60 * 1000;
  }
}

function msToInterval(ms) {
  if (!ms) return { value: 5, unit: "minutes" };
  if (ms >= 3600000 && ms % 3600000 === 0)
    return { value: ms / 3600000, unit: "hours" };
  if (ms >= 60000 && ms % 60000 === 0)
    return { value: ms / 60000, unit: "minutes" };
  return { value: ms / 1000, unit: "seconds" };
}

function TaskScheduleEditor({
  taskDef,
  taskState,
  widgetId,
  widgetName,
  workspaceId,
}) {
  const [enabled, setEnabled] = useState(taskState?.enabled || false);
  const [scheduleType, setScheduleType] = useState(
    taskState?.scheduleType || "interval",
  );

  const initialInterval = msToInterval(taskState?.intervalMs);
  const [intervalValue, setIntervalValue] = useState(initialInterval.value);
  const [intervalUnit, setIntervalUnit] = useState(initialInterval.unit);

  const [days, setDays] = useState(taskState?.days || ["every"]);
  const [time, setTime] = useState(taskState?.time || "09:00");

  const hasSchedule = !!taskState;

  function saveTask(overrides = {}) {
    if (!window.mainApi?.scheduler?.registerTask) return;

    const payload = {
      widgetId,
      widgetName,
      workspaceId: workspaceId || "",
      taskKey: taskDef.key,
      handler: taskDef.handler,
      displayName: taskDef.displayName,
      scheduleType,
      intervalMs: intervalToMs(intervalValue, intervalUnit),
      days,
      time,
      enabled,
      ...overrides,
    };

    window.mainApi.scheduler.registerTask(payload);
  }

  function handleToggle(value) {
    setEnabled(value);
    if (!hasSchedule && value) {
      // First enable — register with default schedule
      saveTask({ enabled: true });
    } else if (hasSchedule) {
      const taskId = `${widgetId}:${taskDef.key}`;
      if (value) {
        window.mainApi?.scheduler?.enableTask(taskId);
      } else {
        window.mainApi?.scheduler?.disableTask(taskId);
      }
    }
  }

  function handleScheduleTypeChange(type) {
    setScheduleType(type);
    saveTask({ scheduleType: type, enabled: true });
    if (!enabled) setEnabled(true);
  }

  function handleIntervalChange(val, unit) {
    setIntervalValue(val);
    if (unit) setIntervalUnit(unit);
    const ms = intervalToMs(val, unit || intervalUnit);
    if (ms) {
      saveTask({
        scheduleType: "interval",
        intervalMs: ms,
        enabled: true,
      });
      if (!enabled) setEnabled(true);
    }
  }

  function handleDayToggle(dayKey) {
    let newDays;
    if (dayKey === "every") {
      newDays = days.includes("every") ? [] : ["every"];
    } else {
      // Remove "every" if it's there, toggle the specific day
      const filtered = days.filter((d) => d !== "every");
      if (filtered.includes(dayKey)) {
        newDays = filtered.filter((d) => d !== dayKey);
      } else {
        newDays = [...filtered, dayKey];
      }
      if (newDays.length === 0) newDays = ["every"];
    }
    setDays(newDays);
    saveTask({ scheduleType: "dayTime", days: newDays, time, enabled: true });
    if (!enabled) setEnabled(true);
  }

  function handleTimeChange(newTime) {
    setTime(newTime);
    saveTask({ scheduleType: "dayTime", days, time: newTime, enabled: true });
    if (!enabled) setEnabled(true);
  }

  return (
    <div className="border border-white/10 rounded-lg p-4 space-y-3">
      {/* Header */}
      <div className="flex flex-row items-center justify-between">
        <div className="flex flex-col">
          <span className="text-sm font-medium">{taskDef.displayName}</span>
          {taskDef.description && (
            <span className="text-xs opacity-50">{taskDef.description}</span>
          )}
        </div>
        <Switch checked={enabled} onChange={handleToggle} />
      </div>

      {/* Schedule configuration (shown when enabled) */}
      {enabled && (
        <div className="space-y-3 pt-1">
          {/* Schedule type radio */}
          <div className="flex flex-row space-x-4">
            <label className="flex items-center space-x-2 cursor-pointer text-sm">
              <input
                type="radio"
                name={`schedule-type-${taskDef.key}`}
                checked={scheduleType === "interval"}
                onChange={() => handleScheduleTypeChange("interval")}
                className="accent-blue-500"
              />
              <span>Interval</span>
            </label>
            <label className="flex items-center space-x-2 cursor-pointer text-sm">
              <input
                type="radio"
                name={`schedule-type-${taskDef.key}`}
                checked={scheduleType === "dayTime"}
                onChange={() => handleScheduleTypeChange("dayTime")}
                className="accent-blue-500"
              />
              <span>Day & Time</span>
            </label>
          </div>

          {/* Interval mode */}
          {scheduleType === "interval" && (
            <div className="flex flex-row items-end space-x-2">
              <InputText
                label="Every"
                type="number"
                value={String(intervalValue)}
                onChange={(val) => handleIntervalChange(val, intervalUnit)}
                className="w-24"
                min="1"
              />
              <SelectInput
                value={intervalUnit}
                onChange={(val) => handleIntervalChange(intervalValue, val)}
                options={INTERVAL_UNITS}
                className="w-32"
              />
            </div>
          )}

          {/* Day & Time mode */}
          {scheduleType === "dayTime" && (
            <div className="space-y-3">
              {/* Day checkboxes */}
              <div className="flex flex-col space-y-2">
                <span className="text-xs opacity-70">Days</span>
                <div className="flex flex-row flex-wrap gap-2">
                  {DAYS.map((day) => {
                    const isSelected =
                      days.includes(day.key) || days.includes("every");
                    return (
                      <button
                        key={day.key}
                        onClick={() => handleDayToggle(day.key)}
                        className={`px-2.5 py-1 text-xs rounded border transition-colors ${
                          isSelected
                            ? "bg-blue-600 border-blue-500 text-white"
                            : "border-white/20 text-white/60 hover:border-white/40"
                        }`}
                      >
                        {day.label}
                      </button>
                    );
                  })}
                  <button
                    onClick={() => handleDayToggle("every")}
                    className={`px-2.5 py-1 text-xs rounded border transition-colors ${
                      days.includes("every")
                        ? "bg-blue-600 border-blue-500 text-white"
                        : "border-white/20 text-white/60 hover:border-white/40"
                    }`}
                  >
                    Every day
                  </button>
                </div>
              </div>

              {/* Time input */}
              <InputText
                label="Time"
                type="time"
                value={time}
                onChange={(val) => handleTimeChange(val)}
                className="w-36"
              />
            </div>
          )}

          {/* Last fired info */}
          {taskState?.lastFiredAt && (
            <div className="text-xs opacity-40">
              <FontAwesomeIcon icon="clock" className="h-3 w-3 mr-1" />
              Last fired: {new Date(taskState.lastFiredAt).toLocaleString()}
              {taskState.fireCount > 0 && ` (${taskState.fireCount} total)`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export const PanelEditItemSchedule = ({ item, workspace, onUpdate }) => {
  const widgetConfig = item
    ? ComponentManager.config(item.component, item)
    : null;
  const scheduledTaskDefs = widgetConfig?.scheduledTasks || [];

  const widgetUuid = item?.uuid || item?.uuidString;
  const widgetName = item?.component;
  const workspaceId = workspace?.id;

  const [taskStates, setTaskStates] = useState({});

  useEffect(() => {
    if (
      scheduledTaskDefs.length > 0 &&
      widgetUuid &&
      window.mainApi?.scheduler?.getTasks
    ) {
      window.mainApi.scheduler.getTasks(widgetUuid).then((tasks) => {
        const stateMap = {};
        for (const task of tasks || []) {
          stateMap[task.taskKey] = task;
        }
        setTaskStates(stateMap);
      });
    }
  }, [widgetUuid, scheduledTaskDefs.length]);

  if (!item || scheduledTaskDefs.length === 0) return null;

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto p-6 space-y-4">
      <SubHeading3 title="Schedule" padding={false} />
      {scheduledTaskDefs.map((taskDef) => (
        <TaskScheduleEditor
          key={taskDef.key}
          taskDef={taskDef}
          taskState={taskStates[taskDef.key] || null}
          widgetId={widgetUuid}
          widgetName={widgetName}
          workspaceId={workspaceId}
        />
      ))}
    </div>
  );
};

export default PanelEditItemSchedule;
