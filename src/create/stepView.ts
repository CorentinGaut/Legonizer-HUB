/** Contract between the create app and its step views. */
import type { IconName } from '../shared/icons.ts';
import type { Actions } from './actions.ts';
import type { EngineService } from './engine.ts';
import type { GuideRoute } from './route.ts';
import type { ProjectState, StepId, Store } from './state.ts';
import type { Stage } from './viewport/stage.ts';

export interface PrimaryAction {
  label: string;
  /** Short label on phones ("Continue"). */
  short?: string;
  run: () => void;
  disabled?: boolean;
  disabledReasonId?: string;
  icon?: IconName;
  kind?: 'primary' | 'secondary';
}

export interface Ctx {
  store: Store;
  engine: EngineService;
  actions: Actions;
  stage: Stage;
  guideRoute: GuideRoute;
  go(step: StepId, opts?: { focus?: boolean; replace?: boolean; sub?: string }): void;
  renderActionbar(): void;
  renderStepper(): void;
  readonly resumeCandidate: ProjectState | null;
  resume(): void;
  startNew(): Promise<void>;
  openProjectPicker(): void;
}

export interface StepView {
  readonly id: StepId;
  mount(panel: HTMLElement): void;
  update(changed: Set<string>): void;
  unmount(): void;
  primary(): PrimaryAction;
}
