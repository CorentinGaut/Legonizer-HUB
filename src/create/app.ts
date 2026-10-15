/**
 * Create page application (SPEC §7): stepper, step panel, viewport stage, action
 * bar, hash routing, project menu, autosave and resume. Steps 1–4 live in ./steps, step 5 in
 * ../guide.
 */
import { getLocale, onLocaleChange, t } from '../shared/i18n.ts';
import { Actions, DEMO_IDS, loadDemoManifests, type DemoId } from './actions.ts';
import { $, announce, attr, debounce, html, ic, openDialog, setHtml, toast, toHtml } from './dom.ts';
import { EngineService } from './engine.ts';
import { timeOfDay } from './format.ts';
import { clearAll, isQuotaError, loadProject, saveProject } from './persist.ts';
import {
  STEPS,
  Store,
  emptyProject,
  isStale,
  stepAvailable,
  stepIndex,
  type ProjectState,
  type StepId,
} from './state.ts';
import type { StepView, Ctx, PrimaryAction } from './stepView.ts';
import { ImportStep } from './steps/import.ts';
import { AreaStep } from './steps/area.ts';
import { SettingsStep } from './steps/settings.ts';
import { GenerateStep } from './steps/generate.ts';
import { Stage } from './viewport/stage.ts';
import { hasWebGL2 } from './viewport/webgl.ts';
import { parseGuideRoute, type GuideRoute } from './route.ts';
import type { GuideView } from '../guide/guide.ts';

export class CreateApp implements Ctx {
  readonly store = new Store();
  readonly engine = new EngineService();
  readonly actions: Actions;
  stage!: Stage;
  private root: HTMLElement;
  private main!: HTMLElement;
  private panel!: HTMLElement;
  private stageEl!: HTMLElement;
  private guideHost!: HTMLElement;
  private actionbar!: HTMLElement;
  private stepperEl!: HTMLElement;
  private view: StepView | null = null;
  private guide: GuideView | null = null;
  private savedProject: ProjectState | null = null;
  private saving = false;
  private saveError = false;
  guideRoute: GuideRoute = { tab: 'bricks' };

  constructor(root: HTMLElement) {
    this.root = root;
    this.actions = new Actions(this.store, this.engine);
    this.actions.onNavigate = (step, focus) => this.go(step, { focus: focus ?? true });
  }

  async start(): Promise<void> {
    this.store.setT({ webgl: hasWebGL2() });
    this.buildLayout();
    this.stage = new Stage(this.stageEl, this);
    this.store.subscribe((_p, _t, changed) => this.onChange(changed));
    this.store.onPersistChange = () => this.scheduleSave();
    onLocaleChange(() => this.rerender());
    window.addEventListener('hashchange', () => this.route(false));
    window.addEventListener('popstate', () => this.route(false));
    this.mountProjectMenu();

    const [demos, saved] = await Promise.all([loadDemoManifests(), loadProject()]);
    this.actions.demos = demos;
    const hasContent = (p: ProjectState | null) => !!p && (!!p.source || !!p.result);
    const hash = location.hash.replace(/^#/, '');
    const query = new URLSearchParams(location.search);
    const demo = query.get('demo');
    const plateMode = /[&?]d=/.test(hash);
    if (plateMode) {
      await this.openPlateMode(hash);
      return;
    }
    if (hasContent(saved) && hash && !hash.startsWith('import')) {
      // reload or deep link inside the wizard: continue where it was
      this.applySaved(saved!);
    } else if (hasContent(saved)) {
      this.savedProject = saved;
    }
    if (demo && (DEMO_IDS as readonly string[]).includes(demo)) {
      this.savedProject = null;
      history.replaceState(null, '', location.pathname + (demo ? '' : location.search) + '#import');
      this.route(true);
      void this.actions.importDemo(demo as DemoId);
      return;
    }
    this.route(true);
  }

  /** Saved project waiting for "Continue" (resume banner). */
  get resumeCandidate(): ProjectState | null {
    return this.savedProject;
  }

  resume(): void {
    const p = this.savedProject;
    if (!p) return;
    this.savedProject = null;
    this.applySaved(p);
    this.go(p.ui.step, { focus: true });
  }

  async startNew(): Promise<void> {
    this.savedProject = null;
    await clearAll();
    this.view?.update(new Set(['source']));
    this.renderStepper();
  }

  private applySaved(p: ProjectState) {
    const base = emptyProject();
    this.store.p = { ...base, ...p, ui: { ...base.ui, ...p.ui } };
    this.store.set({});
    void this.actions.ensureEngineModel();
  }

  // ------------------------------------------------------------------ layout

  private buildLayout() {
    setHtml(
      this.root,
      html`<nav class="lz-stepper" aria-label="${t('create.stepper.label')}" id="lz-stepper"></nav>
        <nav
          class="lz-stepper-compact"
          id="lz-stepper-compact"
          aria-label="${t('create.stepper.label')}"
        ></nav>
        <main id="main" class="lz-create__main" tabindex="-1">
          <section class="lz-panel" id="lz-panel" aria-labelledby="step-title"></section>
          <section class="lz-stage" id="lz-stage"></section>
        </main>
        <main class="lz-guide-host" id="lz-guide-host" tabindex="-1" hidden></main>
        <div
          class="lz-actionbar"
          id="lz-actionbar"
          role="region"
          aria-label="${t('create.shell.actionbarLabel')}"
        ></div>`,
    );
    this.stepperEl = $('#lz-stepper', this.root)!;
    this.main = $('#main', this.root)!;
    this.panel = $('#lz-panel', this.root)!;
    this.stageEl = $('#lz-stage', this.root)!;
    this.guideHost = $('#lz-guide-host', this.root)!;
    this.actionbar = $('#lz-actionbar', this.root)!;
    this.stepperEl.addEventListener('click', (e) => {
      const a = (e.target as Element).closest<HTMLAnchorElement>('a[data-step]');
      if (!a) return;
      e.preventDefault();
      this.go(a.dataset.step as StepId, { focus: true });
    });
    $('#lz-stepper-compact', this.root)!.addEventListener('click', (e) => {
      const b = (e.target as Element).closest('[data-steps-menu]');
      if (b) void this.openStepsMenu();
    });
    this.actionbar.addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLElement>('[data-ab]');
      if (!b) return;
      if (b.dataset.ab === 'back') {
        const i = stepIndex(this.store.p.ui.step);
        if (i > 0) this.go(STEPS[i - 1]!, { focus: true });
      } else if (b.dataset.ab === 'primary') {
        const pa = this.view?.primary();
        if (pa && !pa.disabled) pa.run();
      }
    });
  }

  private rerender() {
    const step = this.store.p.ui.step;
    this.view?.unmount();
    this.view = null;
    this.guide?.unmount();
    this.guide = null;
    this.stage.relabel();
    this.mountStep(step, false);
    this.renderStepper();
    this.mountProjectMenu();
  }

  // ------------------------------------------------------------------ routing

  private route(initial: boolean) {
    const hash = location.hash.replace(/^#/, '');
    if (/[&?]d=/.test(hash)) {
      void this.openPlateMode(hash);
      return;
    }
    const [head] = hash.split('/');
    let step: StepId = (STEPS as string[]).includes(head ?? '') ? (head as StepId) : 'import';
    if (step === 'guide') this.guideRoute = parseGuideRoute(hash);
    if (!stepAvailable(this.store.p, step)) {
      const fallback = [...STEPS].reverse().find((s) => stepAvailable(this.store.p, s)) ?? 'import';
      if (step === 'guide' && !initial) toast(t('create.guide.build.deepLink.noResult'));
      else if (step === 'guide' && initial && hash.startsWith('guide/build/'))
        toast(t('create.guide.build.deepLink.noProject'));
      step = fallback;
      history.replaceState(null, '', `#${step}`);
    }
    this.showStep(step, !initial);
  }

  go(step: StepId, opts: { focus?: boolean; replace?: boolean; sub?: string } = {}) {
    if (!stepAvailable(this.store.p, step)) return;
    const hash = `#${step}${opts.sub ? '/' + opts.sub : ''}`;
    if (location.hash !== hash) {
      if (opts.replace) history.replaceState(null, '', hash);
      else history.pushState(null, '', hash);
    }
    if (step === 'guide') this.guideRoute = parseGuideRoute(hash.slice(1));
    this.showStep(step, opts.focus ?? true);
  }

  private showStep(step: StepId, focus: boolean) {
    const prev = this.store.p.ui.step;
    if (step !== prev) this.store.setUi({ step });
    if (this.view?.id === step && step !== 'guide') {
      this.renderStepper();
      this.renderActionbar();
      return;
    }
    if (step === 'guide' && this.guide) {
      this.guide.route(this.guideRoute);
      this.renderStepper();
      return;
    }
    this.view?.unmount();
    this.view = null;
    this.guide?.unmount();
    this.guide = null;
    this.mountStep(step, focus);
    this.renderStepper();
    if (focus && step !== prev) {
      announce(
        t('a11y.announce.stepChanged', {
          n: stepIndex(step) + 1,
          total: 5,
          name: t(`create.stepper.steps.${step}`),
        }),
      );
    }
  }

  private mountStep(step: StepId, focus: boolean) {
    const isGuide = step === 'guide';
    this.main.hidden = isGuide;
    this.guideHost.hidden = !isGuide;
    this.actionbar.hidden = isGuide;
    this.root.dataset.step = step;
    document.title = `${t(`create.stepper.steps.${step}`)} · ${t('create.meta.title')}`;
    if (isGuide) {
      this.main.removeAttribute('id');
      this.guideHost.id = 'main';
      void import('../guide/guide.ts').then(({ GuideView }) => {
        if (this.store.p.ui.step !== 'guide') return;
        this.guide = new GuideView(this.guideHost, this);
        this.guide.mount(this.guideRoute, focus);
      });
      this.stage.show('none');
      return;
    }
    this.guideHost.removeAttribute('id');
    this.main.id = 'main';
    const View = { import: ImportStep, area: AreaStep, settings: SettingsStep, generate: GenerateStep }[step];
    const view = new View(this);
    this.view = view;
    view.mount(this.panel);
    this.renderActionbar();
    if (focus)
      requestAnimationFrame(() => $<HTMLElement>('#step-title', this.panel)?.focus({ preventScroll: false }));
    this.panel.scrollTop = 0;
  }

  // ------------------------------------------------------------------ state changes

  private onChange(changed: Set<string>) {
    this.view?.update(changed);
    this.guide?.update(changed);
    if (
      changed.has('summary') ||
      changed.has('result') ||
      changed.has('area') ||
      changed.has('params') ||
      changed.has('source') ||
      changed.has('t.generating') ||
      changed.has('ui')
    )
      this.renderStepper();
    this.renderActionbar();
    if (changed.has('name')) this.mountProjectMenu();
    if (changed.has('area') || changed.has('params') || changed.has('importOptions'))
      this.actions.scheduleEstimate();
  }

  renderStepper() {
    const p = this.store.p;
    const cur = p.ui.step;
    const stale = isStale(p);
    const gen = !!this.store.t.generating;
    const items = STEPS.map((s, i) => {
      const name = t(`create.stepper.steps.${s}`);
      const available = stepAvailable(p, s);
      const done =
        s !== cur &&
        ((s === 'import' && (!!p.summary || p.guideOnly)) ||
          (s === 'area' && !!p.area && (stepIndex(cur) > 1 || !!p.result)) ||
          (s === 'settings' && !!p.result) ||
          (s === 'generate' && !!p.result && !stale));
      const attention = (s === 'generate' || s === 'guide') && stale && !!p.result;
      const cls = [
        done ? 'is-done' : '',
        !available ? 'is-unavailable' : '',
        attention ? 'is-attention' : '',
        gen && s === 'generate' ? 'is-busy' : '',
      ]
        .filter(Boolean)
        .join(' ');
      const marker = done && !attention ? ic('check', 'sm') : String(i + 1);
      // label in name (WCAG 2.5.3): only a done step gets an aria-label, because its marker is an
      // icon and its visible text is just the name; aria-current announces the current step and the
      // out-of-date note is visible text
      const doneLabel = done && !attention ? t('create.stepper.state.done', { name }) : null;
      if (!available)
        return html`<li class="${cls}">
          <span class="lz-step" aria-disabled="true" title="${t(`create.stepper.why.${s}`)}"
            ><span class="lz-step__marker" aria-hidden="true">${i + 1}</span
            ><span class="lz-step__label">${name}</span
            ><span class="lz-visually-hidden">, ${t(`create.stepper.why.${s}`)}</span></span
          >
        </li>`;
      return html`<li class="${cls}">
        <a
          class="lz-step"
          href="#${s}"
          data-step="${s}"
          ${attr('aria-current', s === cur ? 'step' : null)}${attr('aria-label', doneLabel)}
          ><span class="lz-step__marker" aria-hidden="true">${marker}</span
          ><span class="lz-step__label">${name}</span>${
            attention ? html`<span class="lz-step__note">· ${t('common.status.outOfDate')}</span>` : ''
          }</a
        >
      </li>`;
    });
    setHtml(
      this.stepperEl,
      html`<ol>
        ${items}
      </ol>`,
    );
    const idx = stepIndex(cur);
    setHtml(
      $('#lz-stepper-compact', this.root)!,
      html`<span class="lz-stepper-compact__label"
          >${t('create.stepper.stepOf', { n: idx + 1, total: 5, name: t(`create.stepper.steps.${cur}`) })}</span
        >
        <button
          type="button"
          class="lz-btn lz-btn--secondary lz-btn--sm"
          aria-haspopup="dialog"
          data-steps-menu
        >
          ${t('create.stepper.menu')} ${ic('chevron-down', 'sm')}
        </button>
        <div class="lz-stepper-compact__bar" aria-hidden="true">
          ${STEPS.map((_, i) => html`<span class="${i <= idx ? 'is-on' : ''}"></span>`)}
        </div>`,
    );
  }

  private async openStepsMenu() {
    const p = this.store.p;
    const body = html`<nav aria-label="${t('create.stepper.label')}">
      <ol class="lz-steps-menu">
        ${STEPS.map((s, i) =>
          stepAvailable(p, s)
            ? html`<li>
                <button
                  type="button"
                  class="lz-btn lz-btn--${s === p.ui.step ? 'primary' : 'secondary'} lz-btn--block"
                  data-value="${s}"
                  ${attr('aria-current', s === p.ui.step ? 'step' : null)}
                >
                  ${i + 1}. ${t(`create.stepper.steps.${s}`)}
                </button>
              </li>`
            : html`<li>
                <span class="lz-muted"
                  >${i + 1}. ${t(`create.stepper.steps.${s}`)} · ${t(`create.stepper.why.${s}`)}</span
                >
              </li>`,
        )}
      </ol>
    </nav>`;
    const choice = await openDialog({ title: t('create.stepper.menu'), body, actions: [] });
    if (choice) this.go(choice as StepId, { focus: true });
  }

  renderActionbar() {
    if (!this.view) return;
    const p = this.store.p;
    const idx = stepIndex(p.ui.step);
    const pa: PrimaryAction = this.view.primary();
    const status = this.saveError
      ? html`<span class="lz-autosave lz-autosave--error"
          >${ic('warning', 'sm')}${t('common.status.notSaved')}</span
        >`
      : this.saving
        ? html`<span class="lz-autosave">${t('common.status.saving')}</span>`
        : p.savedAt && (p.source || p.result)
          ? html`<span class="lz-autosave"
              >${ic('check', 'sm')}${t('common.status.saved', { time: timeOfDay(p.savedAt) })}</span
            >`
          : '';
    const sig = JSON.stringify([
      idx,
      pa.label,
      pa.short,
      pa.disabled,
      pa.icon,
      pa.kind,
      typeof status === 'string' ? status : toHtml(status),
    ]);
    if (this.actionbar.dataset.sig === sig) return;
    this.actionbar.dataset.sig = sig;
    setHtml(
      this.actionbar,
      html`${
          idx > 0
            ? html`<button type="button" class="lz-btn lz-btn--secondary" data-ab="back">
                ${ic('arrow-left')}${t('common.actions.back')}
              </button>`
            : html`<span class="lz-actionbar__spacer"></span>`
        }
        <p class="lz-actionbar__status" role="status">${status}</p>
        <button
          type="button"
          class="lz-btn lz-btn--${pa.kind ?? 'primary'}"
          data-ab="primary"
          ${attr('disabled', !!pa.disabled)}${attr('aria-describedby', pa.disabledReasonId ?? null)}
        >
          ${pa.icon && pa.icon !== 'arrow-right' ? ic(pa.icon) : ''}<span class="u-hide-sm">${pa.label}</span
          ><span class="u-only-sm">${pa.short ?? pa.label}</span
          >${pa.icon === 'arrow-right' || !pa.icon ? ic('arrow-right') : ''}
        </button>`,
    );
  }

  // ------------------------------------------------------------------ autosave

  private scheduleSave = debounce(() => void this.save(), 600);

  private async save() {
    const p = this.store.p;
    if (!p.source && !p.result) return;
    this.saving = true;
    this.renderActionbar();
    try {
      p.savedAt = Date.now();
      await saveProject(p);
      this.saveError = false;
    } catch (e) {
      this.saveError = true;
      if (isQuotaError(e)) toast(t('errors.storageFull'), { icon: 'warning' });
    } finally {
      this.saving = false;
      this.renderActionbar();
    }
  }

  // ------------------------------------------------------------------ project menu

  private mountProjectMenu() {
    const slot = document.getElementById('lz-header-actions');
    if (!slot) return;
    if (this.inPlateMode) {
      // a plate pass carries one plate, not the project: no project menu
      slot.innerHTML = '';
      return;
    }
    const name = this.store.p.name || t('create.project.untitled');
    setHtml(
      slot,
      html`<div class="lz-project">
        <button
          type="button"
          class="lz-btn lz-btn--secondary lz-btn--sm lz-project__btn"
          aria-haspopup="menu"
          aria-expanded="false"
          aria-controls="lz-project-menu"
          id="lz-project-btn"
          title="${t('create.project.menuLabel', { name })}"
        >
          ${ic('folder', 'sm')}<span class="lz-project__label"
            >${t('create.project.menuLabel', { name })}</span
          >${ic('chevron-down', 'sm')}
        </button>
        <ul class="lz-menu" role="menu" id="lz-project-menu" aria-labelledby="lz-project-btn" hidden>
          <li role="none">
            <button type="button" role="menuitem" data-pm="rename">${t('create.project.rename')}</button>
          </li>
          <li role="none">
            <button type="button" role="menuitem" data-pm="save" ${attr('disabled', !this.store.p.result)}>
              ${t('create.project.save')}
            </button>
          </li>
          <li role="none">
            <button type="button" role="menuitem" data-pm="open">${t('create.project.open')}</button>
          </li>
          <li role="none">
            <button type="button" role="menuitem" data-pm="new">${t('create.project.new')}</button>
          </li>
          <li role="none">
            <button type="button" role="menuitem" data-pm="clear" class="is-danger">
              ${t('create.project.clear')}
            </button>
          </li>
        </ul>
        <input type="file" accept=".json,application/json" id="lz-project-file" hidden />
      </div>`,
    );
    const btn = $<HTMLButtonElement>('#lz-project-btn', slot)!;
    const menu = $<HTMLUListElement>('#lz-project-menu', slot)!;
    const items = () => [...menu.querySelectorAll<HTMLButtonElement>('[role=menuitem]:not([disabled])')];
    const close = (focus = true) => {
      menu.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      if (focus) btn.focus();
    };
    const open = () => {
      menu.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      items()[0]?.focus();
    };
    btn.addEventListener('click', () => (menu.hidden ? open() : close()));
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        open();
      }
    });
    menu.addEventListener('keydown', (e) => {
      const list = items();
      const i = list.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === 'ArrowDown') list[(i + 1) % list.length]?.focus();
      else if (e.key === 'ArrowUp') list[(i - 1 + list.length) % list.length]?.focus();
      else if (e.key === 'Home') list[0]?.focus();
      else if (e.key === 'End') list[list.length - 1]?.focus();
      else if (e.key === 'Escape' || e.key === 'Tab') close(e.key === 'Escape');
      else return;
      e.preventDefault();
    });
    document.addEventListener('click', (e) => {
      if (!menu.hidden && !(e.target as Element).closest('.lz-project')) close(false);
    });
    const file = $<HTMLInputElement>('#lz-project-file', slot)!;
    file.addEventListener('change', () => {
      const f = file.files?.[0];
      file.value = '';
      if (f) void this.actions.openProjectFile(f);
    });
    menu.addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLButtonElement>('[data-pm]');
      if (!b) return;
      close(false);
      void this.projectCommand(b.dataset.pm!);
    });
  }

  openProjectPicker() {
    $<HTMLInputElement>('#lz-project-file')?.click();
  }

  private async projectCommand(cmd: string) {
    const p = this.store.p;
    const name = p.name || t('create.project.untitled');
    if (cmd === 'rename') {
      const value = await openDialog({
        title: t('create.project.rename'),
        body: html`<div class="lz-field">
          <label class="lz-label" for="lz-rename">${t('create.project.renameLabel')}</label>
          <div class="lz-input">
            <input id="lz-rename" value="${p.name}" autocomplete="off" maxlength="80" />
          </div>
        </div>`,
        actions: [
          { label: t('common.actions.cancel'), value: '' },
          { label: t('create.project.renameSave'), kind: 'primary', value: 'ok' },
        ],
        onOpen: (d) => {
          const input = d.querySelector<HTMLInputElement>('#lz-rename')!;
          input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              d.querySelector<HTMLButtonElement>('[data-value=ok]')!.click();
            }
          });
          input.focus();
          input.select();
          d.addEventListener('close', () => (this.lastRename = input.value), { once: true });
        },
      });
      if (value === 'ok') {
        const v = this.lastRename ?? '';
        if (v.trim()) this.store.set({ name: v.trim(), nameEdited: true });
      }
    } else if (cmd === 'save') {
      try {
        await this.actions.download('project');
        toast(t('create.project.saved'), { icon: 'check-circle' });
      } catch {
        toast(t('exports.common.error'), { icon: 'warning' });
      }
    } else if (cmd === 'open') {
      this.openProjectPicker();
    } else if (cmd === 'new') {
      const r = await openDialog({
        title: t('create.project.newConfirm.title'),
        body: t('create.project.newConfirm.body', { name }),
        actions: [
          { label: t('common.actions.cancel'), value: '' },
          ...(p.result ? [{ label: t('create.project.newConfirm.saveFirst'), value: 'save' }] : []),
          { label: t('create.project.newConfirm.confirm'), kind: 'primary' as const, value: 'new' },
        ],
      });
      if (r === 'save') await this.actions.download('project');
      if (r === 'new' || r === 'save') await this.actions.newProject();
    } else if (cmd === 'clear') {
      const r = await openDialog({
        title: t('create.project.clearConfirm.title'),
        body: t('create.project.clearConfirm.body'),
        actions: [
          { label: t('common.actions.cancel'), value: '' },
          { label: t('create.project.clearConfirm.confirm'), kind: 'danger', value: 'clear' },
        ],
        focus: 0,
      });
      if (r === 'clear') await this.actions.newProject();
    }
  }
  private lastRename: string | null = null;

  // ------------------------------------------------------------------ plate mode (QR, SPEC O10)

  private inPlateMode = false;

  private async openPlateMode(hash: string) {
    this.inPlateMode = true;
    this.mountProjectMenu();
    this.view?.unmount();
    this.view = null;
    this.guide?.unmount();
    this.guide = null;
    this.main.hidden = true;
    this.actionbar.hidden = true;
    this.stepperEl.hidden = true;
    $('#lz-stepper-compact', this.root)!.hidden = true;
    this.guideHost.hidden = false;
    this.main.removeAttribute('id');
    this.guideHost.id = 'main';
    this.root.dataset.step = 'plate-mode';
    const { PlateModeView } = await import('../guide/plateMode.ts');
    new PlateModeView(this.guideHost, this).mount(hash);
  }

  get locale() {
    return getLocale();
  }
}
