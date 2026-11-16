<template>
  <HistoryPersonal
    v-if="workspace === 'personal' || !historyUIProviderService.isEnabled.value"
  />
  <component :is="platform.ui?.additionalHistoryComponent" v-else />
</template>

<script setup lang="ts">
import { useService } from "dioc/vue";
import { computed } from "vue";
import { platform } from "~/platform";
import { HistoryUIProviderService } from "~/services/history-ui-provider.service";
import { WorkspaceService } from "~/services/workspace.service";

const workspaceService = useService(WorkspaceService)
const historyUIProviderService = useService(HistoryUIProviderService)

const workspace = computed(() => workspaceService.currentWorkspace.value.type)
</script>
