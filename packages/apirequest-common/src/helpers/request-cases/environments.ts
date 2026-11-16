import { cloneDeep } from "lodash-es";
import { environmentsStore, getCurrentEnvironment } from "~/newstore/environments";
import { captureInitialEnvironmentState } from "~/helpers/RequestRunner";
import { getService } from "~/modules/dioc";
import { CurrentValueService } from "~/services/current-environment-value.service";
import { SecretEnvironmentService } from "~/services/secret-environment.service";

export function caseEnvironment(environmentID?: string | null) {
  if (environmentID === undefined) return getCurrentEnvironment()
  if (environmentID === null) return undefined
  const environment = environmentsStore.value.environments.find(
    (env) => env.id === environmentID
  )
  if (!environment) throw new Error("case_environment_missing")
  return environment
}

export function caseEnvironmentState(environmentID?: string | null) {
  const state = cloneDeep(captureInitialEnvironmentState().initialEnvs)
  if (environmentID === undefined) return state
  const environment = caseEnvironment(environmentID)
  const current = getService(CurrentValueService),
    secret = getService(SecretEnvironmentService)
  state.selected =
    environment?.variables.map((variable, index) => {
      const local = variable.secret
        ? secret.getSecretEnvironmentVariableValue(environment.id, index)
        : undefined
      return {
        ...variable,
        initialValue: variable.secret
          ? (local?.initialValue ?? variable.initialValue)
          : variable.initialValue,
        currentValue: variable.secret
          ? (local?.value ?? "")
          : (current.getEnvironmentVariableValue(environment.id, index) ??
            variable.currentValue ??
            ""),
      }
    }) ?? []
  state.temp = []
  return state
}
