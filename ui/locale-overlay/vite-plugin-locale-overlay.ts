/**
 * Build-time locale overlay for the Paperclip UI.
 *
 * Rewrites user-visible English strings in `ui/src/**\/*.tsx` to the
 * translation from `ui/locale-overlay/<locale>.json`, before any other plugin
 * sees the module. Upstream components stay untouched, so merging upstream
 * never conflicts with translations. Inactive unless `PAPERCLIP_UI_LOCALE` is
 * set (or `locale` is passed), which keeps default builds byte-identical to
 * upstream.
 */
import fs from "node:fs";
import path from "node:path";

import type { Plugin, ResolvedConfig } from "vite";

import { type Dictionary, loadDictionary } from "./dictionary";
import { type ModuleOverrideStatus, checkModuleOverrides } from "./module-overrides";
import { applyOverlay } from "./overlay";
import { UI_ROOT, dictionaryPathFor, toPosix } from "./paths";

export interface LocaleOverlayOptions {
  /** Target locale; defaults to `process.env.PAPERCLIP_UI_LOCALE`. Empty or `en` disables the overlay. */
  locale?: string;
}

const PLUGIN_NAME = "paperclip-locale-overlay";

export function localeOverlay(options: LocaleOverlayOptions = {}): Plugin {
  const locale = (options.locale ?? process.env.PAPERCLIP_UI_LOCALE ?? "").trim();
  const enabled = locale !== "" && locale !== "en";
  const dictionaryPath = enabled ? dictionaryPathFor(locale) : "";
  let dictionary: Dictionary | undefined;
  let config: ResolvedConfig | undefined;
  /** UI-relative path → override file, only for overrides whose upstream hash still matches. */
  let activeOverrides = new Map<string, string>();

  const reloadDictionary = () => {
    dictionary = loadDictionary(dictionaryPath);
  };

  const reloadOverrides = (): ModuleOverrideStatus[] => {
    const statuses = checkModuleOverrides(locale);
    activeOverrides = new Map(
      statuses.filter((status) => status.problem === null).map((status) => [status.relativePath, status.overridePath]),
    );
    return statuses;
  };

  return {
    name: PLUGIN_NAME,
    enforce: "pre",
    apply: () => enabled,

    configResolved(resolved) {
      config = resolved;
      if (!fs.existsSync(dictionaryPath)) {
        throw new Error(`[${PLUGIN_NAME}] PAPERCLIP_UI_LOCALE=${locale} but ${dictionaryPath} does not exist`);
      }
      reloadDictionary();
      const overrides = reloadOverrides();
      for (const status of overrides) {
        if (status.problem) {
          resolved.logger.warn(`[${PLUGIN_NAME}] module override ${status.relativePath} disabled: ${status.problem}`);
        }
      }
      resolved.logger.info(
        `[${PLUGIN_NAME}] locale "${locale}": ${dictionary?.entries.length ?? 0} dictionary entries, `
          + `${activeOverrides.size}/${overrides.length} module overrides active`,
      );
    },

    load(id) {
      if (activeOverrides.size === 0) return null;
      const relativePath = toPosix(path.relative(UI_ROOT, id.split("?", 1)[0]));
      const overridePath = activeOverrides.get(relativePath);
      if (!overridePath) return null;
      this.addWatchFile(overridePath);
      return fs.readFileSync(overridePath, "utf8");
    },

    // The overlay already localizes the UI, so browser translation is switched
    // off: translators rewrite React-owned text nodes and the next re-render
    // crashes with "insertBefore: the node ... is not a child of this node".
    transformIndexHtml(html) {
      return {
        html: html.replace(/<html\b([^>]*)\blang="[^"]*"/, `<html$1lang="${locale}" translate="no"`),
        tags: [{ tag: "meta", attrs: { name: "google", content: "notranslate" }, injectTo: "head-prepend" }],
      };
    },

    transform(code, id) {
      if (!dictionary) return null;
      const filePath = id.split("?", 1)[0];
      if (!filePath.endsWith(".tsx")) return null;
      // Relative to the ui/ package, not Vite's `root`: the server's dev
      // middleware and `pnpm --filter` builds run Vite from different cwds.
      const relativePath = toPosix(path.relative(UI_ROOT, filePath));
      if (relativePath.startsWith("../")) return null;
      this.addWatchFile(dictionaryPath);

      try {
        const result = applyOverlay(code, relativePath, dictionary, filePath);
        return result ? { code: result.code, map: result.map } : null;
      } catch (error) {
        // An unparsable module is left alone: the overlay must never be the
        // reason a build fails. React's own transform reports the real error.
        config?.logger.warn(`[${PLUGIN_NAME}] skipped ${relativePath}: ${(error as Error).message}`);
        return null;
      }
    },

    handleHotUpdate(context) {
      if (path.resolve(context.file) !== dictionaryPath) return undefined;
      reloadDictionary();
      for (const module of context.server.moduleGraph.idToModuleMap.values()) {
        if (module.file?.endsWith(".tsx")) context.server.moduleGraph.invalidateModule(module);
      }
      context.server.ws.send({ type: "full-reload" });
      return [];
    },
  };
}
