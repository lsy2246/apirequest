/* eslint-disable @typescript-eslint/no-unused-expressions */
;(inputs) => {
  // Keep strict mode scoped to this IIFE to avoid leaking strictness to concatenated/bootstrapped code
  "use strict"
  // Exposes a host reporter for the generated experimental `try/catch`
  // wrapper in combineScriptsWithIIFE. Locked down (non-writable,
  // non-configurable) so user scripts cannot delete or overwrite it to
  // suppress error reporting. faraday-cage's `runCode` creates a fresh
  // QuickJS runtime per call, so re-definition across calls is not a
  // concern — the property lives only for the current run's VM.
  Object.defineProperty(globalThis, "__hoppReportScriptExecutionError", {
    value: (error) => {
      const safe = error && typeof error === "object" ? error : {}
      inputs.setScriptExecutionError({
        name: typeof safe.name === "string" ? safe.name : "",
        message:
          typeof safe.message === "string" ? safe.message : String(error),
        stack: typeof safe.stack === "string" ? safe.stack : "",
      })
    },
    enumerable: false,
    configurable: false,
    writable: false,
  })
  // Sequential test execution promise chain
  // Initialize with a resolved promise to start the chain
  // Store on globalThis so pm.sendRequest() and test() can both access and modify it
  if (!globalThis.__testExecutionChain) {
    globalThis.__testExecutionChain = Promise.resolve()
  }
  // Chai proxy builder - creates a Chai-like API using actual Chai SDK
  if (!globalThis.__createChaiProxy) {
    globalThis.__createChaiProxy = function (
      expectVal,
      inputs,
      modifiers = " to",
    ) {
      const proxy = {}
      // Helper to create a new proxy with updated modifiers
      const withModifiers = (newModifiers) => {
        return globalThis.__createChaiProxy(expectVal, inputs, newModifiers)
      }
      // Assertion methods
      proxy.equal = (expected) => {
        // PRE-CHECK PATTERN: Track object identity for reference equality
        // Special handling for Date/RegExp which serialize to primitives
        let isSameReference = undefined
        let typeInfo = undefined
        if (
          expectVal !== null &&
          expected !== null &&
          typeof expectVal === "object" &&
          typeof expected === "object"
        ) {
          isSameReference = expectVal === expected
          // Track type for objects that lose identity during serialization
          if (expectVal instanceof Date && expected instanceof Date) {
            typeInfo = {
              type: "Date",
              valueTime: expectVal.getTime(),
              expectedTime: expected.getTime(),
            }
          } else if (
            expectVal instanceof RegExp &&
            expected instanceof RegExp
          ) {
            typeInfo = {
              type: "RegExp",
              valueSource: expectVal.source,
              valueFlags: expectVal.flags,
              expectedSource: expected.source,
              expectedFlags: expected.flags,
            }
          }
        }
        inputs.chaiEqual(
          expectVal,
          expected,
          modifiers,
          "equal",
          isSameReference,
          typeInfo,
        )
        return withModifiers(modifiers)
      }
      proxy.equals = (expected) => {
        // PRE-CHECK PATTERN: Track object identity for reference equality
        // Only pass isSameReference when BOTH values are objects
        let isSameReference = undefined
        if (
          expectVal !== null &&
          expected !== null &&
          typeof expectVal === "object" &&
          typeof expected === "object"
        ) {
          isSameReference = expectVal === expected
        }
        inputs.chaiEqual(
          expectVal,
          expected,
          modifiers,
          "equals",
          isSameReference,
        )
        return withModifiers(modifiers)
      }
      proxy.eq = (expected) => {
        // PRE-CHECK PATTERN: Track object identity for reference equality
        // Only pass isSameReference when BOTH values are objects
        let isSameReference = undefined
        if (
          expectVal !== null &&
          expected !== null &&
          typeof expectVal === "object" &&
          typeof expected === "object"
        ) {
          isSameReference = expectVal === expected
        }
        inputs.chaiEqual(expectVal, expected, modifiers, "eq", isSameReference)
        return withModifiers(modifiers)
      }
      proxy.eql = (expected) => {
        // PRE-CHECK PATTERN: Extract metadata from special objects before serialization
        let valueMetadata = undefined
        let expectedMetadata = undefined
        // Handle RegExp objects - extract pattern and flags
        if (expectVal instanceof RegExp && expected instanceof RegExp) {
          valueMetadata = {
            type: "RegExp",
            source: expectVal.source,
            flags: expectVal.flags,
          }
          expectedMetadata = {
            type: "RegExp",
            source: expected.source,
            flags: expected.flags,
          }
        }
        // Handle Date objects - extract timestamp
        else if (expectVal instanceof Date && expected instanceof Date) {
          valueMetadata = {
            type: "Date",
            time: expectVal.getTime(),
          }
          expectedMetadata = {
            type: "Date",
            time: expected.getTime(),
          }
        }
        inputs.chaiEql(
          expectVal,
          expected,
          modifiers,
          valueMetadata,
          expectedMetadata,
        )
        return withModifiers(modifiers)
      }
      // Custom Postman methods - delegates to chai-helpers.ts
      proxy.jsonSchema = (schema) => {
        if (!inputs.chaiJsonSchema) {
          throw new Error("chaiJsonSchema method not found in inputs")
        }
        inputs.chaiJsonSchema(expectVal, schema, modifiers)
        return withModifiers(modifiers)
      }
      proxy.charset = (expectedCharset) => {
        if (!inputs.chaiCharset) {
          throw new Error("chaiCharset method not found in inputs")
        }
        inputs.chaiCharset(expectVal, expectedCharset, modifiers)
        return withModifiers(modifiers)
      }
      proxy.cookie = (cookieName, cookieValue) => {
        if (!inputs.chaiCookie) {
          throw new Error("chaiCookie method not found in inputs")
        }
        inputs.chaiCookie(expectVal, cookieName, cookieValue, modifiers)
        return withModifiers(modifiers)
      }
      proxy.jsonPath = (path, expectedValue) => {
        if (!inputs.chaiJsonPath) {
          throw new Error("chaiJsonPath method not found in inputs")
        }
        inputs.chaiJsonPath(expectVal, path, expectedValue, modifiers)
        return withModifiers(modifiers)
      }
      // .a() and .an() can be both type assertion methods and language chains for .instanceof
      const aMethod = (type) => {
        // PRE-CHECK PATTERN: Check typeof BEFORE serialization
        // Special handling for null (typeof null === 'object' in JS)
        let actualType = typeof expectVal
        if (expectVal === null) {
          actualType = "null"
        } else if (Array.isArray(expectVal)) {
          actualType = "array"
        }
        // Record the type assertion (valid terminal assertion)
        inputs.chaiTypeOf(expectVal, type, modifiers, actualType)
        return withModifiers(modifiers + ` a ${type}`)
      }
      // Add .instanceof as a property of the function
      const aInstanceOfMethod = function (constructor) {
        // Perform instanceof check in sandbox before serialization.
        const actualInstanceCheck = expectVal instanceof constructor
        const objectType = Object.prototype.toString.call(expectVal)
        let constructorName = "Unknown"
        try {
          if (constructor && typeof constructor.name === "string") {
            constructorName = constructor.name
          } else {
            constructorName = String(constructor)
          }
        } catch (_e) {
          constructorName = String(constructor)
        }
        // PRE-FORMAT: Create display string for Set/Map before serialization
        let displayValue = null
        if (expectVal instanceof Set) {
          const values = Array.from(expectVal).slice(0, 10)
          displayValue =
            values.length > 0 ? `new Set([${values.join(", ")}])` : "new Set()"
        } else if (expectVal instanceof Map) {
          const entries = Array.from(expectVal.entries()).slice(0, 3)
          if (entries.length > 0) {
            const formatted = entries.map(([k, v]) => `['${k}', ${v}]`)
            displayValue = `new Map([${formatted.join(", ")}])`
          } else {
            displayValue = "new Map()"
          }
        }
        inputs.chaiInstanceOf(
          expectVal,
          constructorName,
          modifiers,
          objectType,
          displayValue,
          actualInstanceCheck, // Pass the pre-checked result!
        )
        return withModifiers(modifiers)
      }
      aMethod.instanceof = aInstanceOfMethod
      aMethod.instanceOf = aInstanceOfMethod // Support both lowercase and camelCase
      proxy.a = aMethod
      const anMethod = (type) => {
        // Record the type assertion (valid terminal assertion)
        inputs.chaiTypeOf(expectVal, type, modifiers)
        return withModifiers(modifiers + ` an ${type}`)
      }
      // Add .instanceof as a property of the function
      const instanceOfMethod = function (constructor) {
        // Perform instanceof check in sandbox before serialization.
        const actualInstanceCheck = expectVal instanceof constructor
        const objectType = Object.prototype.toString.call(expectVal)
        let constructorName = "Unknown"
        try {
          if (constructor && typeof constructor.name === "string") {
            constructorName = constructor.name
          } else {
            constructorName = String(constructor)
          }
        } catch (_e) {
          constructorName = String(constructor)
        }
        // PRE-FORMAT: Create display string for Set/Map before serialization
        let displayValue = null
        if (expectVal instanceof Set) {
          const values = Array.from(expectVal).slice(0, 10)
          displayValue =
            values.length > 0 ? `new Set([${values.join(", ")}])` : "new Set()"
        } else if (expectVal instanceof Map) {
          const entries = Array.from(expectVal.entries()).slice(0, 3)
          if (entries.length > 0) {
            const formatted = entries.map(([k, v]) => `['${k}', ${v}]`)
            displayValue = `new Map([${formatted.join(", ")}])`
          } else {
            displayValue = "new Map()"
          }
        }
        return inputs.chaiInstanceOf(
          expectVal,
          constructorName,
          modifiers,
          objectType,
          displayValue,
          actualInstanceCheck, // Pass the pre-checked result!
        )
      }
      anMethod.instanceof = instanceOfMethod
      anMethod.instanceOf = instanceOfMethod // Support both lowercase and camelCase
      proxy.an = anMethod
      // Include can be both a method and have properties (for .include.members and .include.all.keys)
      const includeMethod = (item) => {
        inputs.chaiInclude(expectVal, item, modifiers)
        return withModifiers(modifiers + ` include ${JSON.stringify(item)}`)
      }
      includeMethod.members = (members) => {
        inputs.chaiIncludeMembers(expectVal, members, modifiers)
        return withModifiers(modifiers + ` include members`)
      }
      // Add .all for .include.all.keys
      Object.defineProperty(includeMethod, "all", {
        get: () => {
          const newModifiers = modifiers + " include all"
          const allProxy = {}
          allProxy.keys = (...keys) => {
            inputs.chaiAllKeys(expectVal, keys, newModifiers)
            return withModifiers(newModifiers)
          }
          return allProxy
        },
      })
      // Add .any for .include.any.keys
      Object.defineProperty(includeMethod, "any", {
        get: () => {
          const newModifiers = modifiers + " include any"
          const anyProxy = {}
          anyProxy.keys = (...keys) => {
            inputs.chaiAnyKeys(expectVal, keys, newModifiers)
            return withModifiers(newModifiers)
          }
          return anyProxy
        },
      })
      // Add .keys for .include.keys
      includeMethod.keys = (...keys) => {
        const keysArray =
          keys.length === 1 && Array.isArray(keys[0]) ? keys[0] : keys
        inputs.chaiIncludeKeys(expectVal, keysArray, modifiers)
        return withModifiers(modifiers)
      }
      // Add .deep for .include.deep.ordered.members and deep.include()
      Object.defineProperty(includeMethod, "deep", {
        get: () => {
          const newModifiers = modifiers + " include deep"
          // Create a function that can be called as deep.include(obj)
          const deepIncludeFn = (item) => {
            inputs.chaiDeepInclude(expectVal, item, newModifiers)
            return withModifiers(newModifiers)
          }
          // Add .ordered for .include.deep.ordered
          Object.defineProperty(deepIncludeFn, "ordered", {
            get: () => {
              const orderedModifiers = newModifiers + " ordered"
              const orderedProxy = {}
              orderedProxy.members = (members) => {
                inputs.chaiIncludeDeepOrderedMembers(
                  expectVal,
                  members,
                  orderedModifiers,
                )
                return withModifiers(orderedModifiers)
              }
              return orderedProxy
            },
          })
          return deepIncludeFn
        },
      })
      proxy.include = includeMethod
      proxy.includes = (item) => {
        inputs.chaiInclude(expectVal, item, modifiers)
        return withModifiers(modifiers + ` include ${JSON.stringify(item)}`)
      }
      // Contain can be both a method and have properties (for .contain.oneOf and .contain.members)
      const containMethod = (item) => {
        inputs.chaiInclude(expectVal, item, modifiers)
        return withModifiers(modifiers + ` include ${JSON.stringify(item)}`)
      }
      containMethod.oneOf = (list) => {
        inputs.chaiOneOf(expectVal, list, modifiers + " include")
        return withModifiers(modifiers + " include oneOf")
      }
      containMethod.members = (members) => {
        inputs.chaiIncludeMembers(expectVal, members, modifiers)
        return withModifiers(modifiers + ` include members`)
      }
      proxy.contain = containMethod
      proxy.contains = (item) => {
        inputs.chaiInclude(expectVal, item, modifiers)
        return withModifiers(modifiers + ` include ${JSON.stringify(item)}`)
      }
      // .lengthOf can be used both as a method and as a language chain
      // As method: expect(arr).to.have.lengthOf(5)
      // As chain: expect(arr).to.have.lengthOf.at.least(5)
      Object.defineProperty(proxy, "lengthOf", {
        get: () => {
          // Extract actual length for comparison operations
          let actualLength
          let actualSize, typeName, serializedContent
          // PRE-CHECK PATTERN: Extract size from Set/Map before serialization
          if (expectVal instanceof Set) {
            actualSize = expectVal.size
            actualLength = actualSize
            typeName = "Set"
            serializedContent = Array.from(expectVal)
          } else if (expectVal instanceof Map) {
            actualSize = expectVal.size
            actualLength = actualSize
            typeName = "Map"
            serializedContent = Array.from(expectVal)
          } else {
            try {
              actualLength =
                expectVal && typeof expectVal.length !== "undefined"
                  ? expectVal.length
                  : expectVal && typeof expectVal.size !== "undefined"
                    ? expectVal.size
                    : undefined
            } catch (_e) {
              actualLength = undefined
            }
          }
          // Create a callable function that also has chainable properties
          const lengthOfFn = (length) => {
            inputs.chaiLengthOf(
              serializedContent || expectVal,
              length,
              modifiers,
              "lengthOf",
              actualSize,
              typeName,
            )
            return withModifiers(modifiers + ` lengthOf ${length}`)
          }
          // Add comparison methods for chaining (like .lengthOf.at.least())
          if (actualLength !== undefined) {
            lengthOfFn.above = (n) => {
              inputs.chaiAbove(actualLength, n, modifiers)
              return withModifiers(modifiers)
            }
            lengthOfFn.below = (n) => {
              inputs.chaiBelow(actualLength, n, modifiers)
              return withModifiers(modifiers)
            }
            lengthOfFn.within = (start, end) => {
              inputs.chaiWithin(actualLength, start, end, modifiers)
              return withModifiers(modifiers)
            }
            lengthOfFn.least = (n) => {
              inputs.chaiAtLeast(actualLength, n, modifiers)
              return withModifiers(modifiers)
            }
            lengthOfFn.most = (n) => {
              inputs.chaiAtMost(actualLength, n, modifiers)
              return withModifiers(modifiers)
            }
            lengthOfFn.greaterThan = (n) => {
              inputs.chaiAbove(actualLength, n, modifiers)
              return withModifiers(modifiers)
            }
            lengthOfFn.lessThan = (n) => {
              inputs.chaiBelow(actualLength, n, modifiers)
              return withModifiers(modifiers)
            }
            lengthOfFn.gte = (n) => {
              inputs.chaiAtLeast(actualLength, n, modifiers)
              return withModifiers(modifiers)
            }
            lengthOfFn.lte = (n) => {
              inputs.chaiAtMost(actualLength, n, modifiers)
              return withModifiers(modifiers)
            }
            // Add .at language chain for .lengthOf.at.least() and .lengthOf.at.most()
            Object.defineProperty(lengthOfFn, "at", {
              get: () => {
                const atProxy = withModifiers(modifiers + " at")
                atProxy.least = (n) => {
                  inputs.chaiAtLeast(actualLength, n, modifiers)
                  return withModifiers(modifiers)
                }
                atProxy.most = (n) => {
                  inputs.chaiAtMost(actualLength, n, modifiers)
                  return withModifiers(modifiers)
                }
                return atProxy
              },
              configurable: true,
              enumerable: false,
            })
          }
          return lengthOfFn
        },
        configurable: true,
        enumerable: false,
      })
      // .length as getter property for chaining: .length.above(), .length.below(), .length.within()
      // Also supports .length(n) as method for exact length
      Object.defineProperty(proxy, "length", {
        get: () => {
          // Extract actual length value
          let actualLength
          try {
            actualLength = expectVal.length
          } catch (_e) {
            actualLength = undefined
          }
          // Create callable function for exact length: .length(n)
          const lengthProxy = (length) => {
            // PRE-CHECK PATTERN: Extract size from Set/Map before serialization
            let actualSize, typeName, serializedContent
            if (expectVal instanceof Set) {
              actualSize = expectVal.size
              typeName = "Set"
              serializedContent = Array.from(expectVal)
            } else if (expectVal instanceof Map) {
              actualSize = expectVal.size
              typeName = "Map"
              serializedContent = Array.from(expectVal)
            }
            inputs.chaiLengthOf(
              serializedContent || expectVal,
              length,
              modifiers,
              "length",
              actualSize,
              typeName,
            )
            // Return proxy wrapping the LENGTH VALUE for chaining (.which, .that, etc.)
            return globalThis.__createChaiProxy(
              actualLength,
              inputs,
              modifiers + ` length ${length}`,
            )
          }
          // Add comparison methods for chaining
          lengthProxy.above = (n) => {
            inputs.chaiAbove(actualLength, n, modifiers)
            return withModifiers(modifiers)
          }
          lengthProxy.below = (n) => {
            inputs.chaiBelow(actualLength, n, modifiers)
            return withModifiers(modifiers)
          }
          lengthProxy.within = (start, end) => {
            inputs.chaiWithin(actualLength, start, end, modifiers)
            return withModifiers(modifiers)
          }
          lengthProxy.least = (n) => {
            inputs.chaiAtLeast(actualLength, n, modifiers)
            return withModifiers(modifiers)
          }
          lengthProxy.most = (n) => {
            inputs.chaiAtMost(actualLength, n, modifiers)
            return withModifiers(modifiers)
          }
          lengthProxy.greaterThan = (n) => {
            inputs.chaiAbove(actualLength, n, modifiers)
            return withModifiers(modifiers)
          }
          lengthProxy.lessThan = (n) => {
            inputs.chaiBelow(actualLength, n, modifiers)
            return withModifiers(modifiers)
          }
          lengthProxy.gte = (n) => {
            inputs.chaiAtLeast(actualLength, n, modifiers)
            return withModifiers(modifiers)
          }
          lengthProxy.lte = (n) => {
            inputs.chaiAtMost(actualLength, n, modifiers)
            return withModifiers(modifiers)
          }
          // Add .at language chain for .length.at.least() and .length.at.most()
          Object.defineProperty(lengthProxy, "at", {
            get: () => {
              const atProxy = withModifiers(modifiers + " at")
              atProxy.least = (n) => {
                inputs.chaiAtLeast(actualLength, n, modifiers)
                return withModifiers(modifiers)
              }
              atProxy.most = (n) => {
                inputs.chaiAtMost(actualLength, n, modifiers)
                return withModifiers(modifiers)
              }
              return atProxy
            },
            configurable: true,
            enumerable: false,
          })
          return lengthProxy
        },
        configurable: true,
        enumerable: false,
      })
      proxy.property = (prop, val) => {
        // PRE-CHECK PATTERN: Special handling for Map/Set size property
        // Map and Set serialize as {} losing .size property, so extract it first
        if (
          prop === "size" &&
          (expectVal instanceof Map || expectVal instanceof Set)
        ) {
          const actualSize = expectVal.size
          // Call chaiProperty with actual size value
          inputs.chaiProperty(
            { size: actualSize }, // Wrap size in object
            prop,
            val,
            modifiers,
          )
          // For chaining, return proxy wrapping the size value
          return globalThis.__createChaiProxy(actualSize, inputs, modifiers)
        }
        // PRE-CHECK PATTERN: Check property existence (including inherited) BEFORE serialization
        // The 'in' operator checks for both own and inherited properties
        let hasProperty = undefined
        if (expectVal !== null && typeof expectVal === "object") {
          hasProperty = prop in expectVal
        }
        // When val is provided, assert the property value directly
        inputs.chaiProperty(expectVal, prop, val, modifiers, hasProperty)
        // For chaining (.that, .which), we need to return a proxy wrapping the PROPERTY VALUE
        // Extract the property value from the object
        let propertyValue
        try {
          propertyValue = expectVal[prop]
        } catch (_e) {
          propertyValue = undefined
        }
        // Return a new proxy wrapping the property value, not the original object
        // This allows: .property('a').that.equals(1) to work
        return globalThis.__createChaiProxy(propertyValue, inputs, modifiers)
      }
      proxy.ownProperty = (prop) => {
        // PRE-CHECK PATTERN: Check hasOwnProperty BEFORE serialization
        // Prototype chain is lost when objects cross sandbox boundary
        // Only pass isOwnProperty when value is an object
        let isOwnProperty = undefined
        if (expectVal !== null && typeof expectVal === "object") {
          isOwnProperty = Object.prototype.hasOwnProperty.call(expectVal, prop)
        }
        inputs.chaiOwnProperty(expectVal, prop, modifiers, isOwnProperty)
        // For chaining, return proxy wrapping the property value
        let propertyValue
        try {
          propertyValue = expectVal[prop]
        } catch (_e) {
          propertyValue = undefined
        }
        return globalThis.__createChaiProxy(propertyValue, inputs, modifiers)
      }
      proxy.ownPropertyDescriptor = (prop, descriptor) => {
        // PRE-CHECK PATTERN: Check property descriptor in sandbox before serialization
        let hasDescriptor = false
        let actualDescriptor = null
        let matchesExpected = false
        try {
          actualDescriptor = Object.getOwnPropertyDescriptor(expectVal, prop)
          hasDescriptor = actualDescriptor !== undefined
          // If descriptor argument provided, check if it matches
          if (hasDescriptor && descriptor !== undefined) {
            matchesExpected = true
            // Compare each property of the descriptor
            for (const key in descriptor) {
              if (descriptor[key] !== actualDescriptor[key]) {
                matchesExpected = false
                break
              }
            }
          }
        } catch (_e) {
          hasDescriptor = false
        }
        inputs.chaiOwnPropertyDescriptor(
          expectVal,
          prop,
          descriptor,
          modifiers,
          hasDescriptor,
          matchesExpected,
        )
        // Return a proxy that can chain with .that to access the descriptor
        const descriptorProxy = withModifiers(modifiers)
        // Delete existing .that property if it exists, then redefine it
        delete descriptorProxy.that
        Object.defineProperty(descriptorProxy, "that", {
          configurable: true,
          enumerable: false,
          get: () => {
            // Return a new Chai proxy wrapping the descriptor itself
            return globalThis.__createChaiProxy(actualDescriptor, inputs, " to")
          },
        })
        return descriptorProxy
      }
      proxy.above = (n) => {
        inputs.chaiAbove(expectVal, n, modifiers)
        return withModifiers(modifiers + ` above ${n}`)
      }
      proxy.gt = (n) => {
        inputs.chaiAbove(expectVal, n, modifiers)
        return withModifiers(modifiers + ` above ${n}`)
      }
      proxy.greaterThan = (n) => {
        inputs.chaiAbove(expectVal, n, modifiers)
        return withModifiers(modifiers + ` above ${n}`)
      }
      proxy.greaterThanOrEqual = (n) => {
        inputs.chaiAtLeast(expectVal, n, modifiers)
        return withModifiers(modifiers + ` at least ${n}`)
      }
      proxy.gte = (n) => {
        inputs.chaiAtLeast(expectVal, n, modifiers)
        return withModifiers(modifiers + ` at least ${n}`)
      }
      proxy.below = (n) => {
        inputs.chaiBelow(expectVal, n, modifiers)
        return withModifiers(modifiers + ` below ${n}`)
      }
      proxy.lt = (n) => {
        inputs.chaiBelow(expectVal, n, modifiers)
        return withModifiers(modifiers + ` below ${n}`)
      }
      proxy.lessThan = (n) => {
        inputs.chaiBelow(expectVal, n, modifiers)
        return withModifiers(modifiers + ` below ${n}`)
      }
      proxy.lessThanOrEqual = (n) => {
        inputs.chaiAtMost(expectVal, n, modifiers)
        return withModifiers(modifiers + ` at most ${n}`)
      }
      proxy.lte = (n) => {
        inputs.chaiAtMost(expectVal, n, modifiers)
        return withModifiers(modifiers + ` at most ${n}`)
      }
      proxy.within = (start, end) => {
        inputs.chaiWithin(expectVal, start, end, modifiers)
        return withModifiers(modifiers)
      }
      proxy.closeTo = (expected, delta) => {
        inputs.chaiCloseTo(expectVal, expected, delta, modifiers, "closeTo")
        return withModifiers(modifiers)
      }
      proxy.approximately = (expected, delta) => {
        inputs.chaiCloseTo(
          expectVal,
          expected,
          delta,
          modifiers,
          "approximately",
        )
        return withModifiers(modifiers)
      }
      proxy.keys = (...keys) => {
        // Support both keys('a', 'b') and keys(['a', 'b'])
        const keysArray =
          keys.length === 1 && Array.isArray(keys[0]) ? keys[0] : keys
        inputs.chaiKeys(expectVal, keysArray, modifiers)
        return withModifiers(modifiers)
      }
      proxy.key = (key) => {
        // Support both key('a') and key(['a'])
        const keysArray = Array.isArray(key) ? key : [key]
        inputs.chaiKeys(expectVal, keysArray, modifiers)
        return withModifiers(modifiers)
      }
      proxy.match = (pattern) => {
        // PRE-CHECK PATTERN: Extract RegExp source and flags before serialization
        let regexSource, regexFlags
        if (pattern instanceof RegExp) {
          regexSource = pattern.source
          regexFlags = pattern.flags
        }
        return inputs.chaiMatch(
          expectVal,
          pattern,
          modifiers,
          regexSource,
          regexFlags,
        )
      }
      proxy.matches = (pattern) => {
        // PRE-CHECK PATTERN: Extract RegExp source and flags before serialization
        let regexSource, regexFlags
        if (pattern instanceof RegExp) {
          regexSource = pattern.source
          regexFlags = pattern.flags
        }
        return inputs.chaiMatch(
          expectVal,
          pattern,
          modifiers,
          regexSource,
          regexFlags,
        )
      }
      proxy.string = (substring) =>
        inputs.chaiString(expectVal, substring, modifiers)
      proxy.members = (members) =>
        inputs.chaiMembers(expectVal, members, modifiers)
      proxy.oneOf = (list) => inputs.chaiOneOf(expectVal, list, modifiers)
      proxy.throw = (errorLike, errMsgMatcher) => {
        // PRE-CHECK PATTERN: Execute function in sandbox, pass results
        let threwError = false
        let errorTypeName = null
        let errorMessage = null
        if (typeof expectVal === "function") {
          try {
            expectVal()
          } catch (e) {
            threwError = true
            errorTypeName = e.constructor?.name || "Error"
            errorMessage = e.message || String(e)
          }
        }
        // Handle parameter interpretation like Chai does:
        // .throw() - no params
        // .throw(ErrorType) - constructor function
        // .throw('message') - string message
        // .throw(/pattern/) - regex pattern
        // .throw(ErrorType, 'message') - constructor + message
        // .throw(ErrorType, /pattern/) - constructor + regex
        let actualErrorLike = errorLike
        let actualErrMsgMatcher = errMsgMatcher
        // If first param is string or regex but no second param,
        // treat first param as message matcher, not error type
        if (errorLike !== undefined && errMsgMatcher === undefined) {
          if (typeof errorLike === "string" || errorLike instanceof RegExp) {
            actualErrorLike = undefined
            actualErrMsgMatcher = errorLike
          }
        }
        // Get error type name for matching
        let expectedTypeName = null
        if (actualErrorLike && typeof actualErrorLike === "function") {
          expectedTypeName = actualErrorLike.name
        }
        // Convert RegExp to serializable form or pass string message
        let regexSource, regexFlags
        let isRegexMatcher = false
        if (actualErrMsgMatcher instanceof RegExp) {
          regexSource = actualErrMsgMatcher.source
          regexFlags = actualErrMsgMatcher.flags
          isRegexMatcher = true
        }
        return inputs.chaiThrow(
          expectVal,
          threwError,
          errorTypeName,
          errorMessage,
          expectedTypeName,
          actualErrMsgMatcher,
          regexSource,
          regexFlags,
          isRegexMatcher,
          modifiers,
        )
      }
      proxy.throws = (errorLike, errMsgMatcher) => {
        // PRE-CHECK PATTERN: Execute function in sandbox, pass results
        let threwError = false
        let errorTypeName = null
        let errorMessage = null
        if (typeof expectVal === "function") {
          try {
            expectVal()
          } catch (e) {
            threwError = true
            errorTypeName = e.constructor?.name || "Error"
            errorMessage = e.message || String(e)
          }
        }
        // Handle parameter interpretation like Chai does
        let actualErrorLike = errorLike
        let actualErrMsgMatcher = errMsgMatcher
        // If first param is string or regex but no second param,
        // treat first param as message matcher, not error type
        if (errorLike !== undefined && errMsgMatcher === undefined) {
          if (typeof errorLike === "string" || errorLike instanceof RegExp) {
            actualErrorLike = undefined
            actualErrMsgMatcher = errorLike
          }
        }
        // Get error type name for matching
        let expectedTypeName = null
        if (actualErrorLike && typeof actualErrorLike === "function") {
          expectedTypeName = actualErrorLike.name
        }
        // Convert RegExp to serializable form or pass string message
        let regexSource, regexFlags
        let isRegexMatcher = false
        if (actualErrMsgMatcher instanceof RegExp) {
          regexSource = actualErrMsgMatcher.source
          regexFlags = actualErrMsgMatcher.flags
          isRegexMatcher = true
        }
        return inputs.chaiThrow(
          expectVal,
          threwError,
          errorTypeName,
          errorMessage,
          expectedTypeName,
          actualErrMsgMatcher,
          regexSource,
          regexFlags,
          isRegexMatcher,
          modifiers,
        )
      }
      proxy.Throw = (errorLike, errMsgMatcher) => {
        // PRE-CHECK PATTERN: Execute function in sandbox, pass results
        let threwError = false
        let errorTypeName = null
        let errorMessage = null
        if (typeof expectVal === "function") {
          try {
            expectVal()
          } catch (e) {
            threwError = true
            errorTypeName = e.constructor?.name || "Error"
            errorMessage = e.message || String(e)
          }
        }
        // Handle parameter interpretation like Chai does
        let actualErrorLike = errorLike
        let actualErrMsgMatcher = errMsgMatcher
        // If first param is string or regex but no second param,
        // treat first param as message matcher, not error type
        if (errorLike !== undefined && errMsgMatcher === undefined) {
          if (typeof errorLike === "string" || errorLike instanceof RegExp) {
            actualErrorLike = undefined
            actualErrMsgMatcher = errorLike
          }
        }
        // Get error type name for matching
        let expectedTypeName = null
        if (actualErrorLike && typeof actualErrorLike === "function") {
          expectedTypeName = actualErrorLike.name
        }
        // Convert RegExp to serializable form or pass string message
        let regexSource, regexFlags
        let isRegexMatcher = false
        if (actualErrMsgMatcher instanceof RegExp) {
          regexSource = actualErrMsgMatcher.source
          regexFlags = actualErrMsgMatcher.flags
          isRegexMatcher = true
        }
        return inputs.chaiThrow(
          expectVal,
          threwError,
          errorTypeName,
          errorMessage,
          expectedTypeName,
          actualErrMsgMatcher,
          regexSource,
          regexFlags,
          isRegexMatcher,
          modifiers,
        )
      }
      // PRE-CHECK PATTERN: Check method existence BEFORE serialization
      proxy.respondTo = (method) => {
        // Check if method exists on value or its prototype/constructor
        // When .itself modifier is present, check for static methods on the constructor itself
        const hasItselfModifier = String(modifiers).includes("itself")
        let hasMethod = false
        if (hasItselfModifier) {
          // .itself.respondTo() checks for static methods directly on the constructor/class
          hasMethod = typeof expectVal?.[method] === "function"
        } else {
          // Regular .respondTo() checks instance methods (on value or prototype)
          hasMethod =
            typeof expectVal?.[method] === "function" ||
            typeof expectVal?.prototype?.[method] === "function"
        }
        return inputs.chaiRespondTo(expectVal, method, modifiers, hasMethod)
      }
      proxy.respondsTo = (method) => {
        // Check if method exists on value or its prototype/constructor
        // When .itself modifier is present, check for static methods on the constructor itself
        const hasItselfModifier = String(modifiers).includes("itself")
        let hasMethod = false
        if (hasItselfModifier) {
          // .itself.respondTo() checks for static methods directly on the constructor/class
          hasMethod = typeof expectVal?.[method] === "function"
        } else {
          // Regular .respondTo() checks instance methods (on value or prototype)
          hasMethod =
            typeof expectVal?.[method] === "function" ||
            typeof expectVal?.prototype?.[method] === "function"
        }
        return inputs.chaiRespondTo(expectVal, method, modifiers, hasMethod)
      }
      proxy.satisfy = (matcher) => {
        // PRE-CHECK PATTERN: Execute matcher function in sandbox, pass result
        let satisfyResult = false
        let matcherString = String(matcher)
        if (typeof matcher === "function") {
          try {
            satisfyResult = Boolean(matcher(expectVal))
          } catch (_e) {
            satisfyResult = false
          }
        }
        return inputs.chaiSatisfy(
          expectVal,
          satisfyResult,
          matcherString,
          modifiers,
        )
      }
      proxy.satisfies = (matcher) => {
        // PRE-CHECK PATTERN: Execute matcher function in sandbox, pass result
        let satisfyResult = false
        let matcherString = String(matcher)
        if (typeof matcher === "function") {
          try {
            satisfyResult = Boolean(matcher(expectVal))
          } catch (_e) {
            satisfyResult = false
          }
        }
        return inputs.chaiSatisfy(
          expectVal,
          satisfyResult,
          matcherString,
          modifiers,
        )
      }
      // PRE-CHECK PATTERN: change/increase/decrease assertions
      proxy.change = (obj, prop) => {
        // Support both patterns:
        // 1. change(getter) - getter function pattern
        // 2. change(obj, prop) - object + property pattern
        let initialValue
        let finalValue
        let changed = false
        let delta = 0
        let propName = prop
        try {
          // Pattern 1: Single argument that is a function (getter)
          if (typeof obj === "function" && prop === undefined) {
            initialValue = obj()
            if (typeof expectVal === "function") {
              expectVal()
            }
            finalValue = obj()
            propName = "value" // Use generic name for getter pattern
          }
          // Pattern 2: Object + property name
          else {
            initialValue = obj[prop]
            if (typeof expectVal === "function") {
              expectVal()
            }
            finalValue = obj[prop]
          }
          changed = initialValue !== finalValue
          if (
            typeof initialValue === "number" &&
            typeof finalValue === "number"
          ) {
            delta = finalValue - initialValue
          }
        } catch (_e) {
          changed = false
        }
        // Call the assertion (adds result to testStack)
        inputs.chaiChange(propName, modifiers, changed, delta)
        // Return a proxy with .by() method for chaining
        return {
          by: (expectedDelta) => {
            inputs.chaiChangeBy(
              propName,
              modifiers,
              changed,
              delta,
              expectedDelta,
            )
          },
        }
      }
      proxy.increase = (obj, prop) => {
        // Support both patterns:
        // 1. increase(getter) - getter function pattern
        // 2. increase(obj, prop) - object + property pattern
        let initialValue
        let finalValue
        let increased = false
        let delta = 0
        let propName = prop
        try {
          // Pattern 1: Single argument that is a function (getter)
          if (typeof obj === "function" && prop === undefined) {
            initialValue = obj()
            if (typeof expectVal === "function") {
              expectVal()
            }
            finalValue = obj()
            propName = "value" // Use generic name for getter pattern
          }
          // Pattern 2: Object + property name
          else {
            initialValue = obj[prop]
            if (typeof expectVal === "function") {
              expectVal()
            }
            finalValue = obj[prop]
          }
          if (
            typeof initialValue === "number" &&
            typeof finalValue === "number"
          ) {
            delta = finalValue - initialValue
            increased = delta > 0
          }
        } catch (_e) {
          increased = false
        }
        // Call the assertion (adds result to testStack)
        inputs.chaiIncrease(propName, modifiers, increased, delta)
        // Return a proxy with .by() method for chaining
        return {
          by: (expectedDelta) => {
            inputs.chaiIncreaseBy(
              propName,
              modifiers,
              increased,
              delta,
              expectedDelta,
            )
          },
        }
      }
      proxy.decrease = (obj, prop) => {
        // Support both patterns:
        // 1. decrease(getter) - getter function pattern
        // 2. decrease(obj, prop) - object + property pattern
        let initialValue
        let finalValue
        let decreased = false
        let delta = 0
        let propName = prop
        try {
          // Pattern 1: Single argument that is a function (getter)
          if (typeof obj === "function" && prop === undefined) {
            initialValue = obj()
            if (typeof expectVal === "function") {
              expectVal()
            }
            finalValue = obj()
            propName = "value" // Use generic name for getter pattern
          }
          // Pattern 2: Object + property name
          else {
            initialValue = obj[prop]
            if (typeof expectVal === "function") {
              expectVal()
            }
            finalValue = obj[prop]
          }
          if (
            typeof initialValue === "number" &&
            typeof finalValue === "number"
          ) {
            delta = finalValue - initialValue
            decreased = delta < 0
          }
        } catch (_e) {
          decreased = false
        }
        // Call the assertion (adds result to testStack)
        inputs.chaiDecrease(propName, modifiers, decreased, delta)
        // Return a proxy with .by() method for chaining
        return {
          by: (expectedDelta) => {
            inputs.chaiDecreaseBy(
              propName,
              modifiers,
              decreased,
              delta,
              expectedDelta,
            )
          },
        }
      }
      // PRE-CHECK PATTERN: Check instanceof BEFORE serialization (for custom classes)
      proxy.instanceof = function (constructor) {
        // Debug logging
        if (typeof inputs.chaiInstanceOf !== "function") {
          throw new Error(
            "inputs.chaiInstanceOf is not a function: " +
              typeof inputs.chaiInstanceOf,
          )
        }
        // Perform instanceof check in sandbox before serialization.
        // Essential for custom user-defined classes to work correctly.
        const actualInstanceCheck = expectVal instanceof constructor
        // Get the actual type using Object.prototype.toString for built-ins
        const objectType = Object.prototype.toString.call(expectVal)
        // Get constructor name before serialization (constructors don't cross boundary)
        let constructorName = "Unknown"
        try {
          if (constructor && typeof constructor.name === "string") {
            constructorName = constructor.name
          } else {
            constructorName = String(constructor)
          }
        } catch (_e) {
          constructorName = String(constructor)
        }
        // PRE-FORMAT: Create display string for Set/Map before serialization
        let displayValue = null
        if (expectVal instanceof Set) {
          const values = Array.from(expectVal).slice(0, 10)
          displayValue =
            values.length > 0 ? `new Set([${values.join(", ")}])` : "new Set()"
        } else if (expectVal instanceof Map) {
          const entries = Array.from(expectVal.entries()).slice(0, 3)
          if (entries.length > 0) {
            const formatted = entries.map(([k, v]) => `['${k}', ${v}]`)
            displayValue = `new Map([${formatted.join(", ")}])`
          } else {
            displayValue = "new Map()"
          }
        }
        return inputs.chaiInstanceOf(
          expectVal,
          constructorName,
          modifiers,
          objectType,
          displayValue,
          actualInstanceCheck, // Pass the pre-checked result!
        )
      }
      proxy.instanceOf = function (constructor) {
        // Perform instanceof check in sandbox before serialization.
        const actualInstanceCheck = expectVal instanceof constructor
        // Get the actual type using Object.prototype.toString for built-ins
        const objectType = Object.prototype.toString.call(expectVal)
        // Get constructor name before serialization (constructors don't cross boundary)
        let constructorName = "Unknown"
        try {
          if (constructor && typeof constructor.name === "string") {
            constructorName = constructor.name
          } else {
            constructorName = String(constructor)
          }
        } catch (_e) {
          constructorName = String(constructor)
        }
        // PRE-FORMAT: Create display string for Set/Map before serialization
        let displayValue = null
        if (expectVal instanceof Set) {
          const values = Array.from(expectVal).slice(0, 10)
          displayValue =
            values.length > 0 ? `new Set([${values.join(", ")}])` : "new Set()"
        } else if (expectVal instanceof Map) {
          const entries = Array.from(expectVal.entries()).slice(0, 3)
          if (entries.length > 0) {
            const formatted = entries.map(([k, v]) => `['${k}', ${v}]`)
            displayValue = `new Map([${formatted.join(", ")}])`
          } else {
            displayValue = "new Map()"
          }
        }
        return inputs.chaiInstanceOf(
          expectVal,
          constructorName,
          modifiers,
          objectType,
          displayValue,
          actualInstanceCheck, // Pass the pre-checked result!
        )
      }
      // Assertion getters
      Object.defineProperty(proxy, "ok", {
        get: () => {
          inputs.chaiOk(expectVal, modifiers)
          return withModifiers(modifiers)
        },
      })
      Object.defineProperty(proxy, "true", {
        get: () => {
          inputs.chaiTrue(expectVal, modifiers)
          return withModifiers(modifiers)
        },
      })
      Object.defineProperty(proxy, "false", {
        get: () => {
          inputs.chaiFalse(expectVal, modifiers)
          return withModifiers(modifiers)
        },
      })
      Object.defineProperty(proxy, "null", {
        get: () => {
          inputs.chaiNull(expectVal, modifiers)
          return withModifiers(modifiers)
        },
      })
      Object.defineProperty(proxy, "undefined", {
        get: () => {
          inputs.chaiUndefined(expectVal, modifiers)
          return withModifiers(modifiers)
        },
      })
      Object.defineProperty(proxy, "NaN", {
        get: () => {
          inputs.chaiNaN(expectVal, modifiers)
          return withModifiers(modifiers)
        },
      })
      Object.defineProperty(proxy, "exist", {
        get: () => {
          inputs.chaiExist(expectVal, modifiers)
          return withModifiers(modifiers)
        },
      })
      Object.defineProperty(proxy, "empty", {
        get: () => {
          // PRE-CHECK PATTERN: Pass type info for Set/Map before serialization
          let typeName = null
          let actualSize = null
          if (expectVal instanceof Set) {
            typeName = "Set"
            actualSize = expectVal.size
          } else if (expectVal instanceof Map) {
            typeName = "Map"
            actualSize = expectVal.size
          }
          inputs.chaiEmpty(expectVal, modifiers, typeName, actualSize)
          return withModifiers(modifiers)
        },
      })
      Object.defineProperty(proxy, "finite", {
        get: () => {
          inputs.chaiFinite(expectVal, modifiers)
          return withModifiers(modifiers)
        },
      })
      Object.defineProperty(proxy, "arguments", {
        get: () => {
          // PRE-CHECK PATTERN: Check if value is arguments object before serialization
          const isArguments =
            Object.prototype.toString.call(expectVal) === "[object Arguments]"
          inputs.chaiArguments(expectVal, modifiers + " arguments", isArguments)
          return withModifiers(modifiers)
        },
      })
      Object.defineProperty(proxy, "Arguments", {
        get: () => {
          // PRE-CHECK PATTERN: Check if value is arguments object before serialization
          const isArguments =
            Object.prototype.toString.call(expectVal) === "[object Arguments]"
          inputs.chaiArguments(expectVal, modifiers + " Arguments", isArguments)
          return withModifiers(modifiers)
        },
      })
      // PRE-CHECK PATTERN: Check object state in sandbox BEFORE serialization
      Object.defineProperty(proxy, "extensible", {
        get: () => {
          // Check extensibility in sandbox context before value crosses boundary
          const isExtensible = Object.isExtensible(expectVal)
          // Pass both the value and the pre-checked boolean
          inputs.chaiExtensible(expectVal, modifiers, isExtensible)
          return withModifiers(modifiers)
        },
      })
      Object.defineProperty(proxy, "sealed", {
        get: () => {
          // Check sealed state in sandbox context before value crosses boundary
          const isSealed = Object.isSealed(expectVal)
          // Pass both the value and the pre-checked boolean
          inputs.chaiSealed(expectVal, modifiers, isSealed)
          return withModifiers(modifiers)
        },
      })
      Object.defineProperty(proxy, "frozen", {
        get: () => {
          // Check frozen state in sandbox context before value crosses boundary
          const isFrozen = Object.isFrozen(expectVal)
          // Pass both the value and the pre-checked boolean
          inputs.chaiFrozen(expectVal, modifiers, isFrozen)
          return withModifiers(modifiers)
        },
      })
      // Language chains - return new proxy
      Object.defineProperty(proxy, "to", {
        get: () => withModifiers(" to"),
      })
      Object.defineProperty(proxy, "be", {
        get: () => withModifiers(modifiers + " be"),
      })
      Object.defineProperty(proxy, "been", {
        get: () => withModifiers(modifiers + " been"),
      })
      Object.defineProperty(proxy, "is", {
        get: () => withModifiers(modifiers + " is"),
      })
      Object.defineProperty(proxy, "that", {
        configurable: true, // Allow ownPropertyDescriptor to override this
        get: () => withModifiers(modifiers + " that"),
      })
      Object.defineProperty(proxy, "which", {
        get: () => withModifiers(modifiers + " which"),
      })
      Object.defineProperty(proxy, "and", {
        get: () => withModifiers(modifiers + " and"),
      })
      Object.defineProperty(proxy, "has", {
        get: () => withModifiers(modifiers + " has"),
      })
      Object.defineProperty(proxy, "have", {
        get: () => {
          const haveProxy = withModifiers(modifiers + " have")
          // Add ownPropertyDescriptor method to have proxy
          haveProxy.ownPropertyDescriptor = (prop, descriptor) => {
            // PRE-CHECK PATTERN: Check property descriptor in sandbox before serialization
            let hasDescriptor = false
            let actualDescriptor = null
            let matchesExpected = false
            try {
              actualDescriptor = Object.getOwnPropertyDescriptor(
                expectVal,
                prop,
              )
              hasDescriptor = actualDescriptor !== undefined
              // If descriptor argument provided, check if it matches
              if (hasDescriptor && descriptor !== undefined) {
                matchesExpected = true
                // Compare each property of the descriptor
                for (const key in descriptor) {
                  if (descriptor[key] !== actualDescriptor[key]) {
                    matchesExpected = false
                    break
                  }
                }
              }
            } catch (_e) {
              hasDescriptor = false
            }
            inputs.chaiOwnPropertyDescriptor(
              expectVal,
              prop,
              descriptor,
              modifiers + " have",
              hasDescriptor,
              matchesExpected,
            )
            // Return a proxy that can chain with .that to access the descriptor
            const descriptorProxy = withModifiers(modifiers + " have")
            // Delete existing .that property if it exists, then redefine it
            delete descriptorProxy.that
            Object.defineProperty(descriptorProxy, "that", {
              configurable: true,
              enumerable: false,
              get: () => {
                // Return a new Chai proxy wrapping the descriptor itself
                return globalThis.__createChaiProxy(
                  actualDescriptor,
                  inputs,
                  " to",
                )
              },
            })
            return descriptorProxy
          }
          return haveProxy
        },
      })
      Object.defineProperty(proxy, "with", {
        get: () => withModifiers(modifiers + " with"),
      })
      Object.defineProperty(proxy, "at", {
        get: () => {
          const atProxy = withModifiers(modifiers + " at")
          atProxy.least = (n) => inputs.chaiAtLeast(expectVal, n, modifiers)
          atProxy.most = (n) => inputs.chaiAtMost(expectVal, n, modifiers)
          return atProxy
        },
      })
      Object.defineProperty(proxy, "of", {
        get: () => withModifiers(modifiers + " of"),
      })
      Object.defineProperty(proxy, "same", {
        get: () => withModifiers(modifiers + " same"),
      })
      Object.defineProperty(proxy, "but", {
        get: () => withModifiers(modifiers + " but"),
      })
      Object.defineProperty(proxy, "does", {
        get: () => withModifiers(modifiers + " does"),
      })
      Object.defineProperty(proxy, "itself", {
        get: () => withModifiers(modifiers + " itself"),
      })
      // Modifiers - return new proxy with updated modifiers
      Object.defineProperty(proxy, "not", {
        get: () => withModifiers(" to not"),
      })
      Object.defineProperty(proxy, "deep", {
        get: () => {
          const newModifiers = modifiers + " deep"
          const deepProxy = withModifiers(newModifiers)
          deepProxy.property = (prop, val) => {
            if (val !== undefined) {
              inputs.chaiDeepOwnProperty(expectVal, prop, val, newModifiers)
            } else {
              inputs.chaiProperty(expectVal, prop, val, newModifiers)
            }
          }
          deepProxy.members = (members) =>
            inputs.chaiDeepMembers(expectVal, members, newModifiers)
          deepProxy.include = (item) => {
            inputs.chaiDeepInclude(expectVal, item, newModifiers)
            return withModifiers(newModifiers)
          }
          return deepProxy
        },
      })
      Object.defineProperty(proxy, "own", {
        get: () => {
          const newModifiers = modifiers + " own"
          const ownProxy = withModifiers(newModifiers)
          ownProxy.property = (prop, val) => {
            if (val !== undefined) {
              inputs.chaiDeepOwnProperty(expectVal, prop, val, newModifiers)
            } else {
              // PRE-CHECK PATTERN: Check hasOwnProperty BEFORE serialization
              // Only pass isOwnProperty when value is an object
              let isOwnProperty = undefined
              if (expectVal !== null && typeof expectVal === "object") {
                isOwnProperty = Object.prototype.hasOwnProperty.call(
                  expectVal,
                  prop,
                )
              }
              inputs.chaiOwnProperty(
                expectVal,
                prop,
                newModifiers,
                isOwnProperty,
              )
            }
          }
          return ownProxy
        },
      })
      Object.defineProperty(proxy, "nested", {
        get: () => {
          const newModifiers = modifiers + " nested"
          const nestedProxy = withModifiers(newModifiers)
          nestedProxy.property = (prop, val) =>
            inputs.chaiNestedProperty(expectVal, prop, val, newModifiers)
          // Add .include() for .nested.include() pattern
          nestedProxy.include = (obj) => {
            inputs.chaiNestedInclude(expectVal, obj, newModifiers)
            return withModifiers(newModifiers)
          }
          return nestedProxy
        },
      })
      Object.defineProperty(proxy, "ordered", {
        get: () => {
          const newModifiers = modifiers + " ordered"
          const orderedProxy = withModifiers(newModifiers)
          orderedProxy.members = (members) =>
            inputs.chaiOrderedMembers(expectVal, members, newModifiers)
          return orderedProxy
        },
      })
      Object.defineProperty(proxy, "all", {
        get: () => {
          const newModifiers = modifiers + " all"
          const allProxy = withModifiers(newModifiers)
          allProxy.keys = (...keys) =>
            inputs.chaiAllKeys(expectVal, keys, newModifiers)
          return allProxy
        },
      })
      Object.defineProperty(proxy, "any", {
        get: () => {
          const newModifiers = modifiers + " any"
          const anyProxy = withModifiers(newModifiers)
          anyProxy.keys = (...keys) =>
            inputs.chaiAnyKeys(expectVal, keys, newModifiers)
          return anyProxy
        },
      })
      // .include is defined above as a method with .members property
      // Postman custom Chai assertions (jsonSchema, charset, cookie, jsonPath)
      // These are Postman-specific extensions that work with pm.expect()
      proxy.jsonSchema = (schema) => {
        // Basic JSON Schema validation (supports common keywords)
        const validateSchema = (data, schema) => {
          // Type validation
          if (schema.type) {
            const actualType = Array.isArray(data)
              ? "array"
              : data === null
                ? "null"
                : typeof data
            if (actualType !== schema.type) {
              return `Expected type ${schema.type}, got ${actualType}`
            }
          }
          // Required properties
          if (schema.required && Array.isArray(schema.required)) {
            for (const prop of schema.required) {
              if (!(prop in data)) {
                return `Required property '${prop}' is missing`
              }
            }
          }
          // Properties validation
          if (schema.properties) {
            for (const [key, propSchema] of Object.entries(schema.properties)) {
              if (key in data) {
                const error = validateSchema(data[key], propSchema)
                if (error) return `Property '${key}': ${error}`
              }
            }
          }
          // Enum validation
          if (schema.enum) {
            if (!schema.enum.includes(data)) {
              return `Value must be one of: ${schema.enum.join(", ")}`
            }
          }
          // Number validation
          if (typeof data === "number") {
            if (schema.minimum !== undefined && data < schema.minimum) {
              return `Value ${data} is below minimum ${schema.minimum}`
            }
            if (schema.maximum !== undefined && data > schema.maximum) {
              return `Value ${data} exceeds maximum ${schema.maximum}`
            }
          }
          // String validation
          if (typeof data === "string") {
            if (
              schema.minLength !== undefined &&
              data.length < schema.minLength
            ) {
              return `String length ${data.length} is below minimum ${schema.minLength}`
            }
            if (
              schema.maxLength !== undefined &&
              data.length > schema.maxLength
            ) {
              return `String length ${data.length} exceeds maximum ${schema.maxLength}`
            }
            if (schema.pattern) {
              const regex = new RegExp(schema.pattern)
              if (!regex.test(data)) {
                return `String does not match pattern ${schema.pattern}`
              }
            }
          }
          // Array validation
          if (Array.isArray(data)) {
            if (
              schema.minItems !== undefined &&
              data.length < schema.minItems
            ) {
              return `Array length ${data.length} is below minimum ${schema.minItems}`
            }
            if (
              schema.maxItems !== undefined &&
              data.length > schema.maxItems
            ) {
              return `Array length ${data.length} exceeds maximum ${schema.maxItems}`
            }
            if (schema.items) {
              for (let i = 0; i < data.length; i++) {
                const error = validateSchema(data[i], schema.items)
                if (error) return `Item [${i}]: ${error}`
              }
            }
          }
          return null // Validation passed
        }
        const error = validateSchema(expectVal, schema)
        if (error) {
          throw new Error(`JSON Schema validation failed: ${error}`)
        }
        return withModifiers(modifiers)
      }
      proxy.charset = (expectedCharset) => {
        // expectVal should be a string (typically Content-Type header)
        if (typeof expectVal !== "string") {
          throw new Error(
            "charset() expects a string value (typically Content-Type header)",
          )
        }
        const lowerExpected = expectedCharset.toLowerCase()
        const lowerActual = expectVal.toLowerCase()
        if (!lowerActual.includes(lowerExpected)) {
          throw new Error(
            `Expected charset "${expectedCharset}" not found in "${expectVal}"`,
          )
        }
        return withModifiers(modifiers)
      }
      proxy.cookie = (cookieName, cookieValue) => {
        // This works when expectVal is pm.response or similar
        // For the Chai extension, we need to check if cookies exist
        // This is typically used as: pm.expect(pm.response).to.have.cookie('name')
        // But since we're on a Chai proxy, we assume expectVal is the response object
        if (!expectVal || typeof expectVal !== "object" || !expectVal.cookies) {
          throw new Error(
            "cookie() assertion requires a response object with cookies",
          )
        }
        const hasCookie = expectVal.cookies.has(cookieName)
        if (!hasCookie) {
          throw new Error(`Cookie "${cookieName}" not found in response`)
        }
        if (cookieValue !== undefined) {
          const actualValue = expectVal.cookies.get(cookieName)
          if (actualValue !== cookieValue) {
            throw new Error(
              `Cookie "${cookieName}" has value "${actualValue}", expected "${cookieValue}"`,
            )
          }
        }
        return withModifiers(modifiers)
      }
      // Legacy pw.expect API compatibility methods
      // These provide backward compatibility for tests using the old pw.expect API
      // Legacy API compatibility - delegate to existing legacy functions
      // These handle errors properly by returning test results instead of throwing
      // Check modifiers to determine if negation is needed
      const isNegated = modifiers.includes("not")
      proxy.toBe = (expectedVal) =>
        isNegated
          ? inputs.expectNotToBe(expectVal, expectedVal)
          : inputs.expectToBe(expectVal, expectedVal)
      proxy.toBeLevel2xx = () =>
        isNegated
          ? inputs.expectNotToBeLevel2xx(expectVal)
          : inputs.expectToBeLevel2xx(expectVal)
      proxy.toBeLevel3xx = () =>
        isNegated
          ? inputs.expectNotToBeLevel3xx(expectVal)
          : inputs.expectToBeLevel3xx(expectVal)
      proxy.toBeLevel4xx = () =>
        isNegated
          ? inputs.expectNotToBeLevel4xx(expectVal)
          : inputs.expectToBeLevel4xx(expectVal)
      proxy.toBeLevel5xx = () =>
        isNegated
          ? inputs.expectNotToBeLevel5xx(expectVal)
          : inputs.expectToBeLevel5xx(expectVal)
      proxy.toBeType = (expectedType) => {
        const isDateInstance = expectVal instanceof Date
        return isNegated
          ? inputs.expectNotToBeType(expectVal, expectedType, isDateInstance)
          : inputs.expectToBeType(expectVal, expectedType, isDateInstance)
      }
      proxy.toHaveLength = (expectedLength) =>
        isNegated
          ? inputs.expectNotToHaveLength(expectVal, expectedLength)
          : inputs.expectToHaveLength(expectVal, expectedLength)
      proxy.toInclude = (needle) =>
        isNegated
          ? inputs.expectNotToInclude(expectVal, needle)
          : inputs.expectToInclude(expectVal, needle)
      return proxy
    }
  }
  const toJSON = (input) => {
    if (input == null) return null
    if (typeof input === "string") {
      try {
        return JSON.parse(input)
      } catch {
        throw new Error("Invalid JSON string")
      }
    }
    if (typeof input === "object") {
      return input
    }
    throw new Error(
      "Unsupported input type for hopp.response.asJSON(). Expected string or object.",
    )
  }
  /**
   * Convert input into text (stringify objects, pass strings through).
   */
  const toText = (input) => {
    if (input == null) return ""
    if (typeof input === "string") return input
    if (typeof input === "object") return JSON.stringify(input)
    throw new Error("Unsupported input type for hopp.response.asText()")
  }
  /**
   * Convert input into bytes (UTF-8 encode strings, stringify objects first).
   */
  const toBytes = (input) => {
    if (input == null) return new Uint8Array()
    if (typeof input === "string") return new TextEncoder().encode(input)
    if (typeof input === "object")
      return new TextEncoder().encode(JSON.stringify(input))
    throw new Error("Unsupported input type for hopp.response.bytes()")
  }
  const { status, statusText, headers, responseTime, body } =
    inputs.getResponse()
  const pwResponse = {
    status,
    body,
    headers,
  }
  // Create response body object with read-only methods
  const responseBody = {
    asJSON: () => toJSON(body),
    asText: () => toText(body),
    bytes: () => toBytes(body),
  }
  ;["asJSON", "asText", "bytes"].forEach((method) => {
    Object.defineProperty(responseBody, method, {
      value: responseBody[method],
      writable: false,
      configurable: false,
    })
  })
  Object.freeze(responseBody)
  // Create response object with read-only properties
  const hoppResponse = {}
  // Define response properties and their values
  const responseProperties = {
    statusCode: status,
    statusText: statusText,
    headers: headers,
    responseTime: responseTime,
    body: responseBody,
  }
  // Apply read-only protection to all response properties
  Object.keys(responseProperties).forEach((prop) => {
    Object.defineProperty(hoppResponse, prop, {
      value: responseProperties[prop],
      writable: false,
      enumerable: true,
      configurable: false,
    })
  })
  // Add utility methods to hoppResponse
  Object.defineProperty(hoppResponse, "text", {
    value: () => toText(body),
    writable: false,
    enumerable: true,
    configurable: false,
  })
  Object.defineProperty(hoppResponse, "json", {
    value: () => toJSON(body),
    writable: false,
    enumerable: true,
    configurable: false,
  })
  Object.defineProperty(hoppResponse, "reason", {
    value: () => {
      // Return HTTP reason phrase without status code
      // statusText might be "200 OK" or just "OK"
      const text = statusText || ""
      // If it starts with a number (status code), extract just the reason
      const match = text.match(/^\d+\s+(.+)$/)
      return match ? match[1] : text
    },
    writable: false,
    enumerable: true,
    configurable: false,
  })
  Object.defineProperty(hoppResponse, "dataURI", {
    value: () => {
      // Convert response to data URI format
      try {
        const bytes = toBytes(body)
        const contentTypeHeader = headers.find(
          (h) => h.key.toLowerCase() === "content-type",
        )
        const mimeType = contentTypeHeader
          ? contentTypeHeader.value.split(";")[0].trim()
          : "application/octet-stream"
        // Convert bytes to base64
        let base64 = ""
        if (bytes && typeof bytes === "object") {
          // Handle both array-like and object representations
          const byteArray = Array.isArray(bytes)
            ? bytes
            : Object.keys(bytes)
                .filter((k) => !isNaN(k))
                .map((k) => bytes[k])
          // Convert to binary string
          let binary = ""
          for (let i = 0; i < byteArray.length; i++) {
            binary += String.fromCharCode(byteArray[i])
          }
          // Convert to base64 using btoa if available
          if (typeof btoa !== "undefined") {
            base64 = btoa(binary)
          } else {
            // Fallback: manual base64 encoding
            const chars =
              "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
            for (let i = 0; i < binary.length; i += 3) {
              const b1 = binary.charCodeAt(i) & 0xff
              const b2 = i + 1 < binary.length ? binary.charCodeAt(i + 1) : 0
              const b3 = i + 2 < binary.length ? binary.charCodeAt(i + 2) : 0
              const enc1 = b1 >> 2
              const enc2 = ((b1 & 3) << 4) | (b2 >> 4)
              const enc3 = ((b2 & 15) << 2) | (b3 >> 6)
              const enc4 = b3 & 63
              base64 += chars[enc1] + chars[enc2]
              base64 += i + 1 < binary.length ? chars[enc3] : "="
              base64 += i + 2 < binary.length ? chars[enc4] : "="
            }
          }
        }
        return `data:${mimeType};base64,${base64}`
      } catch (_e) {
        // Fallback: return text as data URI
        try {
          const text = toText(body)
          return `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`
        } catch {
          return "data:,"
        }
      }
    },
    writable: false,
    enumerable: true,
    configurable: false,
  })
  Object.defineProperty(hoppResponse, "jsonp", {
    value: (callbackName = "callback") => {
      // Parse JSONP response by extracting JSON from callback wrapper
      try {
        const text = toText(body)
        // Match pattern: callbackName({...})
        const regex = new RegExp(
          `^\\s*${callbackName}\\s*\\((.*)\\)\\s*;?\\s*$`,
          "s",
        )
        const match = text.match(regex)
        if (match && match[1]) {
          return JSON.parse(match[1])
        }
        // If no callback wrapper, try parsing as JSON directly
        return JSON.parse(text)
      } catch (e) {
        throw new Error(`Failed to parse JSONP response: ${e.message}`)
      }
    },
    writable: false,
    enumerable: true,
    configurable: false,
  })
  // Freeze the entire response object
  Object.freeze(hoppResponse)
  // Immutable getters under the `request` namespace
  const requestProps = {}
  ;["url", "method", "params", "headers", "body", "auth"].forEach((prop) => {
    Object.defineProperty(requestProps, prop, {
      enumerable: true,
      configurable: false,
      get() {
        return inputs.getRequestProps()[prop]
      },
      set(_value) {
        throw new TypeError(`hopp.request.${prop} is read-only`)
      },
    })
  })
  // Special handling for variables property
  Object.defineProperty(requestProps, "variables", {
    enumerable: true,
    configurable: false,
    get() {
      return Object.freeze({
        get: (key) => inputs.getRequestVariable(key),
      })
    },
    set(_value) {
      throw new TypeError(`hopp.request.variables is read-only`)
    },
  })
  // Freeze the entire requestProps object for additional protection
  Object.freeze(requestProps)
  // Special markers for undefined and null values to preserve them across sandbox boundary
  // NOTE: These values MUST match constants/sandbox-markers.ts
  // (Cannot import directly as this runs in QuickJS sandbox)
  const UNDEFINED_MARKER = "__APIREQUEST_UNDEFINED__"
  const NULL_MARKER = "__APIREQUEST_NULL__"
  // Helper function to convert markers back to their original values
  const convertMarkerToValue = (value) => {
    if (value === UNDEFINED_MARKER) return undefined
    if (value === NULL_MARKER) return null
    return value
  }
  // Helper function for PM namespace setters with marker handling
  const pmSetWithMarkers = (key, value, source) => {
    if (typeof value === "undefined") {
      return inputs.pmEnvSetAny(key, UNDEFINED_MARKER, { source })
    } else if (value === null) {
      return inputs.pmEnvSetAny(key, NULL_MARKER, { source })
    } else {
      return inputs.pmEnvSetAny(key, value, { source })
    }
  }
  // Helper function for PM namespace getters with tracking
  const pmGetWithTracking = (getRawFn, trackingSet, key) => {
    const value = getRawFn(key)
    // Return undefined for missing keys, preserve null for explicit null values
    if (value === null && (!trackingSet || !trackingSet.has(key))) {
      return undefined
    }
    return value
  }
  globalThis.hopp = {
    env: {
      get: (key) => {
        const value = inputs.envGetResolve(key, {
          fallbackToNull: true,
          source: "all",
        })
        return convertMarkerToValue(value)
      },
      getRaw: (key) => {
        const value = inputs.envGet(key, {
          fallbackToNull: true,
          source: "all",
        })
        return convertMarkerToValue(value)
      },
      set: (key, value) => inputs.envSet(key, value),
      delete: (key) => inputs.envUnset(key),
      reset: (key) => inputs.envReset(key),
      getInitialRaw: (key) => {
        const value = inputs.envGetInitialRaw(key)
        return convertMarkerToValue(value)
      },
      setInitial: (key, value) => inputs.envSetInitial(key, value),
      active: {
        get: (key) => {
          const value = inputs.envGetResolve(key, {
            fallbackToNull: true,
            source: "active",
          })
          return convertMarkerToValue(value)
        },
        getRaw: (key) => {
          const value = inputs.envGet(key, {
            fallbackToNull: true,
            source: "active",
          })
          return convertMarkerToValue(value)
        },
        set: (key, value) => inputs.envSet(key, value, { source: "active" }),
        delete: (key) => inputs.envUnset(key, { source: "active" }),
        reset: (key) => inputs.envReset(key, { source: "active" }),
        getInitialRaw: (key) => {
          const value = inputs.envGetInitialRaw(key, { source: "active" })
          return convertMarkerToValue(value)
        },
        setInitial: (key, value) =>
          inputs.envSetInitial(key, value, { source: "active" }),
      },
      global: {
        get: (key) => {
          const value = inputs.envGetResolve(key, {
            fallbackToNull: true,
            source: "global",
          })
          return convertMarkerToValue(value)
        },
        getRaw: (key) => {
          const value = inputs.envGet(key, {
            fallbackToNull: true,
            source: "global",
          })
          return convertMarkerToValue(value)
        },
        set: (key, value) => inputs.envSet(key, value, { source: "global" }),
        delete: (key) => inputs.envUnset(key, { source: "global" }),
        reset: (key) => inputs.envReset(key, { source: "global" }),
        getInitialRaw: (key) => {
          const value = inputs.envGetInitialRaw(key, { source: "global" })
          return convertMarkerToValue(value)
        },
        setInitial: (key, value) =>
          inputs.envSetInitial(key, value, { source: "global" }),
      },
    },
    request: requestProps,
    cookies: {
      get: (domain, name) => inputs.cookieGet(domain, name),
      set: (domain, cookie) => inputs.cookieSet(domain, cookie),
      has: (domain, name) => inputs.cookieHas(domain, name),
      getAll: (domain) => inputs.cookieGetAll(domain),
      delete: (domain, name) => inputs.cookieDelete(domain, name),
      clear: (domain) => inputs.cookieClear(domain),
    },
    // Expose fetch as hopp.fetch() - save reference before we override global
    fetch: typeof fetch !== "undefined" ? fetch : undefined,
    expect: Object.assign(
      (expectVal) => {
        // Use Chai if available
        // Note: message parameter is optional and used for custom assertion messages in Postman
        // Currently not fully implemented but accepted for API compatibility
        if (inputs.chaiEqual) {
          return globalThis.__createChaiProxy(expectVal, inputs)
        }
        // Fallback to legacy expectation system
        const isDateInstance = expectVal instanceof Date
        const expectation = {
          toBe: (expectedVal) => inputs.expectToBe(expectVal, expectedVal),
          toBeLevel2xx: () => inputs.expectToBeLevel2xx(expectVal),
          toBeLevel3xx: () => inputs.expectToBeLevel3xx(expectVal),
          toBeLevel4xx: () => inputs.expectToBeLevel4xx(expectVal),
          toBeLevel5xx: () => inputs.expectToBeLevel5xx(expectVal),
          toBeType: (expectedType) =>
            inputs.expectToBeType(expectVal, expectedType, isDateInstance),
          toHaveLength: (expectedLength) =>
            inputs.expectToHaveLength(expectVal, expectedLength),
          toInclude: (needle) => inputs.expectToInclude(expectVal, needle),
        }
        Object.defineProperty(expectation, "not", {
          get: () => ({
            toBe: (expectedVal) => inputs.expectNotToBe(expectVal, expectedVal),
            toBeLevel2xx: () => inputs.expectNotToBeLevel2xx(expectVal),
            toBeLevel3xx: () => inputs.expectNotToBeLevel3xx(expectVal),
            toBeLevel4xx: () => inputs.expectNotToBeLevel4xx(expectVal),
            toBeLevel5xx: () => inputs.expectNotToBeLevel5xx(expectVal),
            toBeType: (expectedType) =>
              inputs.expectNotToBeType(expectVal, expectedType, isDateInstance),
            toHaveLength: (expectedLength) =>
              inputs.expectNotToHaveLength(expectVal, expectedLength),
            toInclude: (needle) => inputs.expectNotToInclude(expectVal, needle),
          }),
        })
        return expectation
      },
      {
        // expect.fail() - Chai compatibility
        // Supports multiple signatures:
        // expect.fail()
        // expect.fail(message)
        // expect.fail(actual, expected)
        // expect.fail(actual, expected, message)
        // expect.fail(actual, expected, message, operator)
        fail: (actual, expected, message, operator) => {
          if (inputs.chaiFail) {
            inputs.chaiFail(actual, expected, message, operator)
          } else {
            // Fallback: throw an error with the message
            const errorMessage =
              message ||
              (actual !== undefined && expected !== undefined
                ? `expected ${actual} to ${operator || "equal"} ${expected}`
                : "expect.fail()")
            throw new Error(errorMessage)
          }
        },
      },
    ),
    test: (descriptor, testFn) => {
      // Register test immediately in definition order
      inputs.preTest(descriptor)
      // Capture chain state BEFORE executing testFn() to detect pm.sendRequest() usage
      const _chainBeforeTest = globalThis.__testExecutionChain
      // Add testFn execution to the chain to ensure correct context
      const testPromise = globalThis.__testExecutionChain.then(async () => {
        inputs.setCurrentTest(descriptor)
        try {
          const testResult = testFn()
          // If test returns a promise, await it
          if (testResult && typeof testResult.then === "function") {
            await testResult
          }
        } catch (error) {
          // Record uncaught errors in test functions (e.g., ReferenceError, TypeError)
          // This ensures errors like accessing undefined variables are captured
          const errorMessage =
            error && typeof error === "object" && "message" in error
              ? `${error.name || "Error"}: ${error.message}`
              : String(error)
          inputs.pushExpectResult("error", errorMessage)
        } finally {
          inputs.clearCurrentTest()
          inputs.postTest()
        }
      })
      // Update the chain
      globalThis.__testExecutionChain = testPromise
      // Notify runner about the test promise so it can be awaited
      if (inputs.onTestPromise) {
        inputs.onTestPromise(testPromise)
      }
    },
    response: hoppResponse,
  }
  // Initialize tracking Sets for PM namespace from incoming envs
  // This allows toObject() to work even when variables were set in previous scripts
  // Make global fetch() an alias to hopp.fetch()
  // Both fetch() and hopp.fetch() respect interceptor settings
  if (typeof fetch !== "undefined") {
    // hopp.fetch is already set from inputs, just create the alias
    globalThis.fetch = globalThis.hopp.fetch
  } else if (typeof globalThis.hopp?.fetch !== "undefined") {
    // If fetch wasn't available but hopp.fetch is, create the global alias
    globalThis.fetch = globalThis.hopp.fetch
  }
  // Return the test execution chain promise so the host can await it
  // This ensures all tests complete before results are captured
  return globalThis.__testExecutionChain
}
