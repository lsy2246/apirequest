export default [
  {
    name: "workbench.snippets.environment",
    script: `\n\n// Set an environment variable
hopp.env.set("variable", "value");`,
  },
  {
    name: "workbench.snippets.status200",
    script: `\n\n// Check status code is 200
hopp.test("Status code is 200", ()=> {
    hopp.expect(hopp.response.statusCode).toBe(200);
});`,
  },
  {
    name: "workbench.snippets.body",
    script: `\n\n// Check JSON response property
hopp.test("Check JSON response property", ()=> {
    hopp.expect(hopp.response.body.asJSON().method).toBe("GET");
});`,
  },
  {
    name: "workbench.snippets.status2xx",
    script: `\n\n// Check status code is 2xx
hopp.test("Status code is 2xx", ()=> {
    hopp.expect(hopp.response.statusCode).toBeLevel2xx();
});`,
  },
  {
    name: "workbench.snippets.status3xx",
    script: `\n\n// Check status code is 3xx
hopp.test("Status code is 3xx", ()=> {
    hopp.expect(hopp.response.statusCode).toBeLevel3xx();
});`,
  },
  {
    name: "workbench.snippets.status4xx",
    script: `\n\n// Check status code is 4xx
hopp.test("Status code is 4xx", ()=> {
    hopp.expect(hopp.response.statusCode).toBeLevel4xx();
});`,
  },
  {
    name: "workbench.snippets.status5xx",
    script: `\n\n// Check status code is 5xx
hopp.test("Status code is 5xx", ()=> {
    hopp.expect(hopp.response.statusCode).toBeLevel5xx();
});`,
  },
]
