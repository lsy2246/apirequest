import { Ref, Component } from "vue";
export type UIPlatformDef = {
  appHeader?: {
    paddingTop?: Ref<string>
    paddingLeft?: Ref<string>

    /**
     * A function which is called when the header area of the app receives a click event
     */
    onHeaderAreaClick?: () => void
  }
  onCodemirrorInstanceMount?: (element: HTMLElement) => void

  /**
   * Additional Settings Section components in the settings page
   */
  additionalSettingsSections?: Component[]

  /**
   * Additional profile Section components in the profile page
   */
  additionalProfileSections?: Component[]

  /**
   * Custom history related components to be shown in the history page
   */
  additionalHistoryComponent?: Component

  /**
   * Custom sidebar header item to be shown in the sidebar header
   */
  additionalSidebarHeaderItem?: Component

  /**
   * Custom invite component to be shown in the team invite page
   */
  additionalTeamInviteComponent?: Component

  /**
   * Custom edit component to be shown in the team edit page
   */
  additionalTeamEditComponent?: Component

  /**
   * More info shown in the danger zone section while attempting user deletion
   * Sample use case includes displaying the instance information on cloud instances
   */
  additionalUserDeletionSoleTeamOwnerInfo?: Component
}
