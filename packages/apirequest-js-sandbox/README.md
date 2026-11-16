<div align="center">
  <a href="https://example.com">
    <img
      src="https://avatars.githubusercontent.com/u/56705483"
      alt="APIRequest Logo"
      height="64"
    />
  </a>
</div>
<div align="center">

# APIRequest JavaScript Sandbox <font size=2><sup>ALPHA</sup></font>

</div>

This package deals with providing a JavaScript sandbox for executing various security sensitive external scripts.

## How does this work?

This package makes use of [quickjs-emscripten](https://www.npmjs.com/package/quickjs-emscripten) for building sandboxes for running external code on APIRequest.

Currently implemented sandboxes:
- APIRequest Test Scripts
- APIRequest Pre Request Scripts

## Development

1. Clone the repository

```
git clone https://github.com/lsy2246/apirequest
```

2. Install the package dependencies

```
pnpm install
```

3. Navigate to the [package folder](https://github.com/lsy2246/apirequest/tree/main/packages/apirequest-js-sandbox)
```
cd apirequest/packages/apirequest-js-sandbox
```


4. Build the package

```bash
pnpm run build
```

5. Run the test suite

```bash
pnpm run test
```

## Versioning
This project follows [Semantic Versioning](https://semver.org/) but as the project is still pre-1.0. The code and the public exposed API should not be considered to be fixed and stable. Things can change at any time!

## License
This project is licensed under the [MIT License](https://opensource.org/licenses/MIT) - see [`LICENSE`](../../LICENSE) for more details.

<div align="center">
  <br />
  <br />

  ###### built with ❤︎ by the [API Request contributors](https://github.com/lsy2246) and [contributors](https://github.com/lsy2246/apirequest/graphs/contributors).

</div>
