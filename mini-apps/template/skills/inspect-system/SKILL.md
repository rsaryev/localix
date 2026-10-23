---
name: inspect-system
description: >-
  Inspect and explain the Localix backend machine's operating system, CPU utilization, memory,
  uptime, Bun runtime, and processes with System Overview. Save comparison marks when requested. Use
  for system-information, runtime-health, or environment-summary requests; not for changing machine
  configuration.
---

# Inspect the backend system

Use `system_overview` when the user asks about the machine running the Localix backend. The tool is
read-only and returns a timestamped snapshot. It does not describe the browser device when the UI
and API run on different machines.

## Interpret the snapshot

- Treat CPU utilization as a sampled value, not a capacity guarantee. A first sample may say that a
  second sample is required. Snapshots are cached for one second; wait at least that long before
  repeating the tool if current utilization matters. An immediate repeat can return the same sample.
- Treat used memory as total minus free. It includes memory used for operating-system caches, so a
  high percentage alone does not prove memory pressure.
- Distinguish system uptime from Bun process uptime. A recently restarted Localix process can run on
  a machine that has been up for days.
- Preserve the snapshot timestamp when comparing values or reporting that information may be stale.

## Choose the source

When the System Overview pane has published message context, use it to explain exactly what the user
sees. Call `system_overview` for a fresh snapshot or when no pane context is present. If both are
available and differ, identify their timestamps instead of silently combining them.

Report unavailable fields as unavailable. Do not infer hostnames, usernames, paths, network
addresses, temperatures, disk state, process command lines, or a diagnosis: this plugin
intentionally does not collect them. Ask before proposing any separate mutating or shell-based
investigation unless the user's existing request already authorizes it.

## Marks

Use `system_mark` when the user wants to compare the machine before and after something — a build,
closing an app: it saves a short note with the CPU and memory of that moment, and the mark appears
in the System Overview view. Mark before and after the change the user names, then compare the two
samples; say that one sample of CPU is noisy rather than calling a difference a result. Marks are
durable plugin state, not a read-only observation: up to 50 are retained, with notes limited to 200
characters. They can outlive a pane or conversation.

Mark values use the same one-second snapshot cache. A newly saved mark does not force a new CPU
sample. The tool's mutation effect is `host`, so conversation permissions can refuse it even when
the read-only tools remain available.

## Processes

Use `system_processes` for a current, CPU-sorted process list. It provides process names, PIDs,
parent PIDs, CPU, and memory. When the user asks to manage a process, identify it precisely, explain
the impact, and use native system tools only after the user's intent is clear. Refresh the list
before acting to reduce the risk of targeting a reused PID, and verify the result afterward. The
plugin intentionally provides context rather than hardcoded process actions.

The collector retains at most 500 rows; the tool formats the first 100, and pane/resource context
formats the first 50 before the host's context budget applies. These are partial lists, so an
omitted process is not proof that it is absent. Unix CPU values come from `ps`; Windows values use
counter deltas divided by logical core count and are unavailable on the first read. Do not assume
the two platforms' percentages describe identical sampling intervals or compare them directly with
the system-wide CPU gauge.
