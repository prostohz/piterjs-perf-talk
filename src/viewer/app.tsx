import { useEffect, useRef, useState } from "react";
import type { Catalog, RunDetail, RunSummary } from "./model.js";
import { Button } from "./components/ui/button.js";
import { formatDate, Picker, StatusBadge } from "./components/shared.js";
import { RunView } from "./components/run-view.js";

const runKey = (run: RunSummary) => JSON.stringify([run.target, run.id]);
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

async function fetchJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? `HTTP ${response.status}`);
  return value as T;
}

export function App() {
  const [catalog, setCatalog] = useState<RunSummary[]>([]);
  const [filter, setFilter] = useState("");
  const filterRef = useRef("");
  const [selected, setSelected] = useState<RunSummary>();
  const [loaded, setLoaded] = useState<{ key: string; detail: RunDetail }>();
  const [error, setError] = useState<{ key: string; message: string }>();
  const [notice, setNotice] = useState("");
  const [catalogBusy, setCatalogBusy] = useState(true);
  const [detailBusy, setDetailBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetchJson<Catalog>("/api/runs", controller.signal)
      .then(({ runs }) => {
        if (controller.signal.aborted) return;
        setCatalog(runs);
        if (!runs.some((run) => run.target === filterRef.current)) {
          filterRef.current = "";
          setFilter("");
        }
        const query = new URLSearchParams(location.search);
        setSelected(
          (previous) =>
            runs.find(
              (run) =>
                run.target === (previous?.target ?? query.get("target")) &&
                run.id === (previous?.id ?? query.get("run")),
            ) ??
            runs.find(
              (run) => !filterRef.current || run.target === filterRef.current,
            ),
        );
        setNotice(
          runs.some((run) => run.error)
            ? "Некоторые отчёты недоступны — выберите их для подробностей."
            : "",
        );
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setNotice(`Не удалось обновить: ${message(error)}`);
      })
      .finally(() => {
        if (!controller.signal.aborted) setCatalogBusy(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    const key = runKey(selected);
    const query = new URLSearchParams({
      target: selected.target,
      run: selected.id,
    });
    const url = new URL(location.href);
    if (
      url.searchParams.get("target") !== selected.target ||
      url.searchParams.get("run") !== selected.id
    )
      url.searchParams.delete("attempt");
    url.searchParams.set("target", selected.target);
    url.searchParams.set("run", selected.id);
    history.replaceState(null, "", url);
    setDetailBusy(true);
    void fetchJson<RunDetail>(`/api/run?${query}`, controller.signal)
      .then((detail) => {
        if (controller.signal.aborted) return;
        setLoaded({ key, detail });
        setError(undefined);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setError({ key, message: message(error) });
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailBusy(false);
      });
    return () => controller.abort();
  }, [selected]);

  const visible = catalog.filter((run) => !filter || run.target === filter);
  const key = selected ? runKey(selected) : "";
  const detail = loaded?.key === key ? loaded.detail : undefined;
  const currentError = error?.key === key ? error.message : undefined;
  const busy = catalogBusy || (selected !== undefined && detailBusy);
  return (
    <div className="grid min-h-dvh min-w-6xl grid-cols-[232px_minmax(0,1fr)]">
      <aside className="sticky top-0 h-dvh overflow-y-auto border-r bg-muted px-4 pt-12 pb-6">
        <h1 className="mb-6 text-base font-semibold">Прогоны</h1>
        <Picker
          label="Таргет"
          id="target"
          value={filter}
          onChange={(event) => {
            const value = event.target.value;
            filterRef.current = value;
            setFilter(value);
            if (selected && value && selected.target !== value)
              setSelected(catalog.find((run) => run.target === value));
          }}
        >
          <option value="">Все таргеты</option>
          {[...new Set(catalog.map((run) => run.target))].sort().map((name) => (
            <option key={name}>{name}</option>
          ))}
        </Picker>
        <p
          id="notice"
          role="status"
          className="mt-4 text-xs text-destructive empty:hidden"
        >
          {notice}
        </p>
        <nav id="runs" aria-label="Запуски" className="mt-6 space-y-1 p-1">
          {visible.map((run) => (
            <Button
              key={runKey(run)}
              data-target={run.target}
              data-run={run.id}
              aria-current={runKey(run) === key ? "true" : "false"}
              variant="ghost"
              className="block h-auto w-full p-3 text-left whitespace-normal shadow-none active:bg-accent aria-[current=true]:bg-accent aria-[current=true]:shadow-[inset_0_0_0_1px_var(--border)]"
              onClick={() => setSelected(run)}
            >
              <strong className="block text-sm font-semibold">
                {run.target}
              </strong>
              <span className="mt-1 block truncate text-xs font-normal text-muted-foreground">
                {run.startedAt ? formatDate(run.startedAt) : run.id}
              </span>
              <span className="mt-3 flex flex-col items-start gap-1.5">
                <StatusBadge status={run.status ?? "failed"} />
                <small className="text-xs font-normal text-muted-foreground">
                  {run.error
                    ? "Отчёт недоступен"
                    : `${run.accepted} / ${run.attempts} принято`}
                </small>
              </span>
            </Button>
          ))}
          {!catalogBusy && !visible.length && (
            <p className="text-muted-foreground">Запусков пока нет.</p>
          )}
        </nav>
      </aside>
      <main
        id="main"
        aria-live="polite"
        aria-busy={busy}
        className="min-w-0 p-12"
      >
        {currentError ? (
          <div className="py-12 text-muted-foreground">
            <h2 className="mb-3 text-xl font-semibold">Отчёт недоступен</h2>
            <p className="wrap-anywhere">{currentError}</p>
            <p>Выберите другой запуск или обновите страницу.</p>
          </div>
        ) : detail && selected ? (
          <RunView key={key} detail={detail} run={selected} />
        ) : (
          <p className="py-12 text-muted-foreground">
            {selected
              ? "Загрузка отчёта…"
              : catalogBusy
                ? "Читаем историю из runs…"
                : notice
                  ? "Не удалось прочитать каталог. Попробуйте обновить страницу."
                  : "В папке runs пока нет запусков. После прогона обновите страницу."}
          </p>
        )}
      </main>
    </div>
  );
}
