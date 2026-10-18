import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Popper from "@mui/material/Popper";
import Portal from "@mui/material/Portal";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useMediaQuery, useTheme } from "@mui/material";
import { alpha, type Theme } from "@mui/material/styles";

import { glassSx } from "@/kit/glass";

/**
 * ВСПЛЫВАЮЩАЯ КАРТОЧКА СУЩНОСТИ — ОБРАЗЕЦ ПАРТИИ 59, ВТОРОЙ ЗАХОД (песочница).
 *
 * ПРИНЦИП: карточка = «главное за 1 секунду». Первый заход был анкетой из
 * шести-семи строк «подпись — значение», и главное в ней не схватывалось.
 * Теперь:
 *   — шапка: фото полосой во всю ширину (заведение, позиция) или крупная
 *     плитка со значком или номером; имя крупно, с переносом, без «…»;
 *     статус — цветной плашкой;
 *   — 2–3 главных факта крупно, значком и цветом, без табличек;
 *   — одно главное действие и «Открыть», остальное — на странице.
 *
 * Механика открытия — `EntityName`: наведение 350/200 мс на ПК, фокус и Esc,
 * лист снизу на телефоне. Рабочие экраны её пока не используют.
 */

export const HOVER_OPEN_MS = 350;
export const HOVER_CLOSE_MS = 200;
export const CARD_WIDTH = 320;

export type Tone = "success" | "warning" | "error" | "info" | "neutral";

/** Цвет тона из палитры темы: плашки статуса и факты. */
export function toneColor(theme: Theme, tone: Tone): string {
  if (tone === "neutral") return theme.palette.text.primary;
  return theme.palette[tone].main;
}

/** Текст тона: на светлой теме — тёмный вариант, чтобы держать 4,5 на стекле. */
export function toneText(theme: Theme, tone: Tone): string {
  if (tone === "neutral") return theme.palette.text.primary;
  return theme.palette.mode === "light"
    ? theme.palette[tone].dark
    : theme.palette[tone].light;
}

export interface EntityFact {
  icon?: ReactNode;
  text: ReactNode;
  tone?: Tone;
}

export interface EntityCardProps {
  /** Тип — для `aria-label`; на карточке тип говорит фото или значок. */
  kind: string;
  title: ReactNode;
  /** Строка под именем: тип номера, место заказа. */
  subtitle?: ReactNode;
  /** Фото полосой во всю ширину (заведение, позиция). */
  banner?: ReactNode;
  /** Крупная плитка слева от имени — когда фото нет (заказ, номер). */
  tile?: ReactNode;
  status?: { label: string; tone: Tone; icon?: ReactNode };
  /** Одно крупное число: обратный отсчёт заказа, цена позиции. */
  hero?: { text: ReactNode; caption?: ReactNode; tone?: Tone };
  facts?: EntityFact[];
  /** Свободный блок: шкала этапов, исполнитель. */
  extra?: ReactNode;
  primary?: { label: string; tone?: "primary" | "danger" };
  openLabel?: string;
  testId?: string;
  /** Лист на телефоне — во всю ширину, скругление сверху. */
  sheet?: boolean;
}

function StatusPill({
  label,
  tone,
  icon,
}: NonNullable<EntityCardProps["status"]>) {
  return (
    <Box
      sx={(theme) => ({
        display: "inline-flex",
        alignItems: "center",
        gap: 0.5,
        px: 1.25,
        py: 0.375,
        borderRadius: 999,
        typography: "body2",
        fontWeight: 600,
        lineHeight: 1.3,
        color: toneText(theme, tone),
        bgcolor: alpha(
          toneColor(theme, tone),
          theme.palette.mode === "light" ? 0.14 : 0.22,
        ),
        whiteSpace: "nowrap",
        "& svg": { width: 16, height: 16 },
      })}
    >
      {icon}
      {label}
    </Box>
  );
}

export function EntityCardBody({
  kind,
  title,
  subtitle,
  banner,
  tile,
  status,
  hero,
  facts = [],
  extra,
  primary,
  openLabel = "Открыть",
  testId,
  sheet = false,
}: EntityCardProps) {
  const label = typeof title === "string" ? `${kind}: ${title}` : kind;
  return (
    <Box
      data-testid={testId}
      role="dialog"
      aria-label={label}
      sx={(theme: Theme) => ({
        // Уровень `sheet` — плотнее `menu`: в карточке текст, и подписи должны
        // держать 4,5 над чем угодно (у `menu` под ней просвечивали фото).
        ...glassSx(theme, "sheet"),
        // Светлое стекло на белой странице без края не видно: кромка цвета
        // разделителя и тень плотнее, чем у меню.
        ...(theme.palette.mode === "light"
          ? {
              border: `1px solid ${theme.palette.divider}`,
              boxShadow: `0 18px 40px -16px ${alpha(theme.palette.brand.scrim, 0.45)}`,
            }
          : {}),
        width: sheet ? "100%" : CARD_WIDTH,
        borderRadius: sheet ? "20px 20px 0 0" : 3,
        overflow: "hidden",
        color: "text.primary",
      })}
    >
      {banner ? (
        <Box
          sx={{
            position: "relative",
            height: sheet ? 150 : 120,
            overflow: "hidden",
          }}
        >
          {banner}
          {status ? (
            <Box
              sx={(theme) => ({
                position: "absolute",
                top: 10,
                left: 10,
                borderRadius: 999,
                bgcolor: theme.palette.background.paper,
              })}
            >
              <StatusPill {...status} />
            </Box>
          ) : null}
        </Box>
      ) : null}

      <Box sx={{ p: 2, pt: banner ? 1.5 : 2 }}>
        <Stack direction="row" spacing={1.5} alignItems="center">
          {tile ? <Box sx={{ flexShrink: 0 }}>{tile}</Box> : null}
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography
              component="div"
              sx={{
                typography: "h6",
                fontWeight: 700,
                lineHeight: 1.2,
                overflowWrap: "anywhere",
              }}
            >
              {title}
            </Typography>
            {subtitle ? (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mt: 0.25, overflowWrap: "anywhere" }}
              >
                {subtitle}
              </Typography>
            ) : null}
          </Box>
        </Stack>

        {status && !banner ? (
          <Box sx={{ mt: 1.25 }}>
            <StatusPill {...status} />
          </Box>
        ) : null}

        {hero ? (
          <Stack
            direction="row"
            alignItems="baseline"
            spacing={1}
            sx={{ mt: 1.25 }}
          >
            <Typography
              component="div"
              sx={(theme) => ({
                typography: "h4",
                fontWeight: 700,
                lineHeight: 1,
                color: toneText(theme, hero.tone ?? "neutral"),
                fontVariantNumeric: "tabular-nums",
              })}
            >
              {hero.text}
            </Typography>
            {hero.caption ? (
              <Typography variant="body2" color="text.secondary">
                {hero.caption}
              </Typography>
            ) : null}
          </Stack>
        ) : null}

        {extra ? <Box sx={{ mt: 1.25 }}>{extra}</Box> : null}

        {facts.length ? (
          <Stack spacing={0.75} sx={{ mt: 1.25 }}>
            {facts.map((fact, index) => (
              <Stack
                key={index}
                direction="row"
                spacing={1}
                alignItems="center"
                sx={(theme) => ({
                  typography: "body1",
                  fontWeight: 500,
                  color: toneText(theme, fact.tone ?? "neutral"),
                  "& svg": { width: 20, height: 20, flexShrink: 0 },
                })}
              >
                {fact.icon}
                <Box sx={{ minWidth: 0, overflowWrap: "anywhere" }}>
                  {fact.text}
                </Box>
              </Stack>
            ))}
          </Stack>
        ) : null}

        <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 2 }}>
          {primary ? (
            <Button
              size="medium"
              variant="contained"
              color={primary.tone === "danger" ? "error" : "primary"}
              sx={{ flexShrink: 0 }}
            >
              {primary.label}
            </Button>
          ) : null}
          <Box sx={{ flex: 1 }} />
          <Button size="medium" endIcon={<span aria-hidden>→</span>}>
            {openLabel}
          </Button>
        </Stack>
      </Box>
    </Box>
  );
}

/**
 * Имя сущности с карточкой — механика образца. Клик по имени на ПК остаётся
 * переходом; карточка — наведение и фокус. На телефоне первое нажатие —
 * карточка листом снизу, переход — кнопкой «Открыть».
 */
export function EntityName({
  children,
  card,
  testId,
}: {
  children: ReactNode;
  card: EntityCardProps;
  testId?: string;
}) {
  const theme = useTheme();
  const touch = useMediaQuery("(hover: none)");
  const phone = useMediaQuery(theme.breakpoints.down("sm"));
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  const schedule = useCallback((next: boolean, ms: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(next), ms);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const sheet = touch || phone;

  return (
    <>
      <Box
        component="a"
        href="#"
        ref={setAnchor}
        data-testid={testId}
        aria-haspopup="dialog"
        aria-expanded={open}
        onMouseEnter={() => !sheet && schedule(true, HOVER_OPEN_MS)}
        onMouseLeave={() => !sheet && schedule(false, HOVER_CLOSE_MS)}
        onFocus={() => !sheet && schedule(true, 0)}
        onBlur={() => !sheet && schedule(false, HOVER_CLOSE_MS)}
        onClick={(event) => {
          // Образец: переходов нет. В рабочем экране на ПК клик — переход,
          // на телефоне первое нажатие — карточка. Внутри кликабельной строки
          // (карточка трекера) имя гасит всплытие, иначе откроется и шторка.
          event.preventDefault();
          event.stopPropagation();
          if (sheet) setOpen((v) => !v);
        }}
        sx={{
          color: "inherit",
          fontWeight: "inherit",
          textDecoration: "underline",
          textDecorationStyle: "dotted",
          textDecorationThickness: "1.5px",
          textUnderlineOffset: "3px",
          textDecorationColor: (t) => alpha(t.palette.text.primary, 0.45),
          cursor: "pointer",
          '&:hover, &:focus-visible, &[aria-expanded="true"]': {
            textDecorationStyle: "solid",
            textDecorationColor: (t) => t.palette.primary.main,
          },
        }}
      >
        {children}
      </Box>
      {sheet ? (
        open ? (
          // В ПОРТАЛЕ, а не на месте: у стеклянного предка (строка списка,
          // карточка доски) `backdrop-filter` становится опорой для `fixed`,
          // и лист рисовался внутри строки, а не внизу экрана (замер заход 2).
          <Portal>
            <Box
              data-testid="entity-sheet"
              onClick={() => setOpen(false)}
              sx={{
                position: "fixed",
                inset: 0,
                zIndex: (t) => t.zIndex.modal,
                bgcolor: (t) => alpha(t.palette.brand.scrim, 0.45),
                display: "flex",
                alignItems: "flex-end",
              }}
            >
              <Box
                sx={{ width: "100%" }}
                onClick={(event) => event.stopPropagation()}
              >
                <EntityCardBody {...card} sheet />
              </Box>
            </Box>
          </Portal>
        ) : null
      ) : (
        <Popper
          open={open && Boolean(anchor)}
          anchorEl={anchor}
          placement="bottom-start"
          modifiers={[{ name: "offset", options: { offset: [0, 8] } }]}
          sx={{ zIndex: (t) => t.zIndex.tooltip }}
        >
          <Box
            onMouseEnter={() => schedule(true, 0)}
            onMouseLeave={() => schedule(false, HOVER_CLOSE_MS)}
          >
            <EntityCardBody {...card} />
          </Box>
        </Popper>
      )}
    </>
  );
}
