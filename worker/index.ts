/**
 * Worker entry point.
 *
 * IMPORTANT: the Workers runtime treats every named export of the entry module
 * as an `ExportedHandler` map entry and refuses to boot when a name resolves
 * to anything else:
 *
 *   Uncaught TypeError: Incorrect type for map entry 'NAME':
 *   the provided value is not of type 'function or ExportedHandler'.
 *
 * The implementation therefore lives in `./internal-impl` and this module
 * exposes a default export only. Tests import the helpers they need from
 * `./internal` (or `./internal-impl`), never from here.
 */
import handler from "./internal-impl";

export default handler;
