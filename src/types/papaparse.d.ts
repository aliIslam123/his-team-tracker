declare module "papaparse" {
  const Papa: {
    parse: (input: unknown, config?: unknown) => { data: unknown[] };
  };
  export default Papa;
}
