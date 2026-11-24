/**
 * Записанные демо-прогоны (scripts/record-demo.ts). Статические импорты — чтобы JSON попали в
 * серверную сборку (Vercel) и демо работало без файловой системы и сети.
 * Порядок совпадает с DEMO_EXAMPLES; первый — прогон по умолчанию.
 */
import type { DemoRun } from "@/server/api/demo-sanitize";
import upakovkaKofe from "./upakovka-kofe-moskva.json";
import yagody from "./yagody-zamorozka-novosibirsk.json";
import syr from "./syr-picceriya-kazan.json";
import muka from "./muka-krasnodar.json";
import pelmeni from "./pelmeni-spb.json";
import pechenye from "./pechenye-nn.json";
import posuda from "./posuda-ekb.json";

export const DEMO_RUNS = [upakovkaKofe, yagody, syr, muka, pelmeni, pechenye, posuda] as unknown as readonly DemoRun[];
export { DEMO_EXAMPLES } from "./examples";
