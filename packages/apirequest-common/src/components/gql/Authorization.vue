<template>
  <div class="flex flex-1 flex-col">
    <div
      class="sticky top-sidebarPrimaryStickyFold z-10 flex items-center justify-between border-y border-dividerLight bg-primary pl-4"
    >
      <span class="flex items-center">
        <label class="truncate font-semibold text-secondaryLight">
          {{ t("authorization.type") }}
        </label>
        <tippy
          interactive
          trigger="click"
          theme="popover"
          :on-shown="() => tippyActions.focus()"
        >
          <HoppSmartSelectWrapper>
            <HoppButtonSecondary
              class="ml-2 rounded-none pr-8"
              :label="authName"
            />
          </HoppSmartSelectWrapper>
          <template #content="{ hide }">
            <div
              ref="tippyActions"
              class="flex flex-col focus:outline-none"
              tabindex="0"
              @keyup.escape="hide()"
            >
              <HoppSmartItem
                v-for="item in authTypes"
                :key="item.key"
                :label="item.label"
                :icon="item.key === authType ? IconCircleDot : IconCircle"
                :active="item.key === authType"
                @click="
                  () => {
                    item.handler
                      ? item.handler()
                      : (auth = { ...auth, authType: item.key } as HoppGQLAuth)
                    hide()
                  }
                "
              />
            </div>
          </template>
        </tippy>
      </span>
      <div class="flex">
        <WorkbenchToggle
          :on="authActive"
          class="px-2"
          @change="authActive = !authActive"
        >
          {{ t("state.enabled") }}
        </WorkbenchToggle>
        <HoppButtonSecondary
          v-tippy="{ theme: 'tooltip' }"
          :title="t('action.clear')"
          :icon="IconTrash2"
          @click="clearContent"
        />
      </div>
    </div>
    <HoppSmartPlaceholder
      v-if="auth.authType === 'none'"
      :src="`/images/states/${colorMode.value}/login.svg`"
      :alt="`${t('empty.authorization')}`"
      :text="t('empty.authorization')"
    >
      <template #body> </template>
    </HoppSmartPlaceholder>
    <div v-else class="flex flex-1 border-b border-dividerLight">
      <div class="w-2/3 border-r border-dividerLight">
        <div v-if="auth.authType === 'basic'">
          <div class="flex flex-1 border-b border-dividerLight">
            <SmartEnvInput
              v-model="auth.username"
              :auto-complete-env="true"
              :envs="envs"
              :placeholder="t('authorization.username')"
            />
          </div>
          <div class="flex flex-1 border-b border-dividerLight">
            <SmartEnvInput
              v-model="auth.password"
              :auto-complete-env="true"
              :envs="envs"
              :placeholder="t('authorization.password')"
            />
          </div>
        </div>
        <div v-if="auth.authType === 'inherit'" class="p-4">
          <span v-if="inheritedProperties?.auth">
            {{
              t("authorization.inherited_from", {
                auth: getAuthName(
                  (inheritedProperties.auth.inheritedAuth as HoppGQLAuth)
                    .authType
                ),
                collection: inheritedProperties?.auth.parentName,
              })
            }}
          </span>
          <span v-else>
            {{ t("authorization.save_to_inherit") }}
          </span>
        </div>
        <div v-if="auth.authType === 'bearer'">
          <div class="flex flex-1 border-b border-dividerLight">
            <SmartEnvInput
              v-model="auth.token"
              :auto-complete-env="true"
              :envs="envs"
              :placeholder="t('authorization.token')"
            />
          </div>
        </div>
        <div v-if="auth.authType === 'oauth-2'">
          <div class="flex flex-1 border-b border-dividerLight">
            <SmartEnvInput
              v-model="auth.grantTypeInfo.token"
              :auto-complete-env="true"
              :envs="envs"
              :placeholder="t('authorization.token')"
            />
          </div>
          <HttpAuthorizationOAuth2 v-model="auth" :envs="envs" />
        </div>
        <div v-if="auth.authType === 'api-key'">
          <HttpAuthorizationApiKey v-model="auth" :envs="envs" />
        </div>
        <div v-if="auth.authType === 'aws-signature'">
          <HttpAuthorizationAWSSign v-model="auth" :envs="envs" />
        </div>
      </div>
      <div
        class="z-[9] sticky top-upperTertiaryStickyFold h-full min-w-[12rem] max-w-1/3 flex-shrink-0 overflow-auto overflow-x-auto bg-primary p-4"
      >
        <div class="pb-2 text-secondaryLight">
          {{ t("helpers.authorization") }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import WorkbenchToggle from "~/components/workbench/Toggle.vue"
import { useI18n } from "@composables/i18n";
import { pluckRef } from "@composables/ref";
import { useColorMode } from "@composables/theming";
import { HoppGQLAuth, HoppGQLAuthOAuth2, HoppGQLAuthAWSSignature } from "@apirequest/data";
import { useVModel } from "@vueuse/core";
import { computed, ref } from "vue";

import { HoppInheritedProperty } from "~/helpers/types/HoppInheritedProperties";
import { AggregateEnvironment } from "~/newstore/environments";

import IconCircle from "~icons/lucide/circle";
import IconCircleDot from "~icons/lucide/circle-dot";
import IconTrash2 from "~icons/lucide/trash-2";

import { getDefaultAuthCodeOauthFlowParams } from "~/services/oauth/flows/authCode";

type AuthType = {
  key: HoppGQLAuth["authType"]
  label: string
  handler?: () => void
}

const t = useI18n()

const colorMode = useColorMode()

const props = defineProps<{
  modelValue: HoppGQLAuth
  inheritedProperties?: HoppInheritedProperty
  // Embed-only env scope; omit to use the global aggregate envs
  envs?: AggregateEnvironment[]
}>()

const emit = defineEmits<{
  (e: "update:modelValue", value: HoppGQLAuth): void
}>()

const auth = useVModel(props, "modelValue", emit)

const selectOAuth2AuthType = () => {
  const defaultGrantTypeInfo: HoppGQLAuthOAuth2["grantTypeInfo"] = {
    ...getDefaultAuthCodeOauthFlowParams(),
    grantType: "AUTHORIZATION_CODE",
    token: "",
  }

  // @ts-expect-error - the existing grantTypeInfo might be in the auth object, typescript doesnt know that
  const existingGrantTypeInfo = auth.value.grantTypeInfo as
    HoppGQLAuthOAuth2["grantTypeInfo"] | undefined

  const grantTypeInfo = existingGrantTypeInfo
    ? existingGrantTypeInfo
    : defaultGrantTypeInfo

  auth.value = {
    ...auth.value,
    authType: "oauth-2",
    addTo: "HEADERS",
    grantTypeInfo: grantTypeInfo,
  }
}

const selectAPIKeyAuthType = () => {
  auth.value = {
    ...auth.value,
    authType: "api-key",
    addTo: "HEADERS",
  } as HoppGQLAuth
}

const selectAWSSignatureAuthType = () => {
  const {
    accessKey = "",
    secretKey = "",
    region = "",
    serviceName = "",
    addTo = "HEADERS",
  } = auth.value as HoppGQLAuthAWSSignature

  auth.value = {
    ...auth.value,
    authType: "aws-signature",
    addTo,
    accessKey,
    secretKey,
    region,
    serviceName,
  }
}

// 标签按当前语言计算，切换语言时不改变认证类型及处理函数。
const authTypes = computed<AuthType[]>(() => [
  {
    key: "inherit",
    label: t("authorization.inherit"),
  },
  {
    key: "none",
    label: t("state.none"),
  },
  {
    key: "basic",
    label: t("documentation.auth.basic_auth"),
  },
  {
    key: "bearer",
    label: t("documentation.auth.bearer_token"),
  },
  {
    key: "oauth-2",
    label: t("documentation.auth.oauth_2"),
    handler: selectOAuth2AuthType,
  },
  {
    key: "api-key",
    label: t("documentation.auth.api_key"),
    handler: selectAPIKeyAuthType,
  },
  {
    key: "aws-signature",
    label: t("documentation.auth.aws_signature"),
    handler: selectAWSSignatureAuthType,
  },
])

const AUTH_KEY_NAME: Record<HoppGQLAuth["authType"], string> = {
  basic: "documentation.auth.basic_auth",
  bearer: "documentation.auth.bearer_token",
  "oauth-2": "documentation.auth.oauth_2",
  "api-key": "documentation.auth.api_key",
  none: "state.none",
  inherit: "authorization.inherit",
  "aws-signature": "documentation.auth.aws_signature",
}

const authType = pluckRef(auth, "authType")

const authName = computed(() =>
  t(AUTH_KEY_NAME[authType.value] ?? "state.none")
)

const getAuthName = (type: HoppGQLAuth["authType"] | undefined) => {
  if (!type) return t("state.none")
  return t(AUTH_KEY_NAME[type] ?? "state.none")
}

const authActive = pluckRef(auth, "authActive")

const clearContent = () => {
  auth.value = {
    authType: "inherit",
    authActive: true,
  }
}

const tippyActions = ref<any | null>(null)
</script>
