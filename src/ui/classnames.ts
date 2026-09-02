const hasOwn = {}.hasOwnProperty;

export default function classNames(...args: unknown[]): string {
  let classes = "";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg) {
      classes = appendClass(classes, parseValue(arg));
    }
  }

  return classes;
}

function parseValue(arg: unknown): string {
  if (typeof arg === "string") {
    return arg;
  }

  if (typeof arg !== "object" || arg === null) {
    return "";
  }

  if (Array.isArray(arg)) {
    return classNames(...(arg as unknown[]));
  }

  if (
    (arg as any).toString !== Object.prototype.toString &&
    !(arg as any).toString.toString().includes("[native code]")
  ) {
    return (arg as any).toString();
  }

  let classes = "";

  for (const key in arg as Record<string, unknown>) {
    if (hasOwn.call(arg, key) && (arg as Record<string, unknown>)[key]) {
      classes = appendClass(classes, key);
    }
  }

  return classes;
}

function appendClass(value: string, newClass: string) {
  if (!newClass) {
    return value;
  }

  return value ? (value + " " + newClass) : newClass;
}