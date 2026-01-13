import { DebugProtocol } from '@vscode/debugprotocol'

export type VarRefInfo = {
    /**
     * Routing of the underlying PS container that contains the current PS object
     */
    router: string[]
    /**
     * The corresponding index or key of the current PS object in its container
     */
    name: string
    /**
     * The underlying type of the current PS object
     */
    type: string
    value?: string
}
export type VarRefAllocator = (info: VarRefInfo) => number

const entryMatcher = /PS_ENTRY_START([\s\S]*?)PS_ENTRY_END/g
const propMatcher = /PS_PROP_START([\s\S]*?)PS_PROP_END/g
const nameMatcher = /PS_NAME_START([\s\S]*?)PS_NAME_END/
const valueMatcher = /PS_VALUE_START([\s\S]*?)PS_VALUE_END/
export function ps_parser(data: string) {
    const vars: { [key: string]: string }[] = []
    let entryMatch: RegExpExecArray | null
    while ((entryMatch = entryMatcher.exec(data)) !== null) {
        let propMatch: RegExpExecArray | null
        let props = entryMatch[1]
        let kvs: { [key: string]: string } = {}
        while ((propMatch = propMatcher.exec(props)) !== null) {
            var _name = propMatch[1].match(nameMatcher)
            var _value = propMatch[1].match(valueMatcher)
            if (_name && _value) {
                var name = _name[1].trim()
                var value = _value[1].trim()
                kvs[name] = value
            }
        }
        vars.push(kvs)
    }
    return vars
}
export function pickVariableWithRoute(out: string, router: string[], alloc: VarRefAllocator): DebugProtocol.Variable[] {
    return ps_parser(out).map(obj => {
        const tmp = { name: obj.name, value: obj.value, type: obj.type }
        const d_var: DebugProtocol.Variable = { ...tmp, variablesReference: 0 }
        if (obj.length) {
            const n = Number(obj.length)
            if (n > 0) {
                d_var.variablesReference = alloc({ ...tmp, router })
                if (tmp.type === 'dicttype')
                    d_var.namedVariables = n
                else d_var.indexedVariables = n
                d_var.evaluateName = `[${[...router, tmp.name].join(' ')}]`
            }
        }
        return d_var
    })
}
export function arraysEqual(arr1: any[], arr2: any[]) {
    if (arr1.length !== arr2.length) return false;
    for (let i = 0; i < arr1.length; i++) {
        if (arr1[i] !== arr2[i]) return false;
    }
    return true;
}
const errorMatcher = /PS_ERROR_START([\s\S]*?)PS_ERROR_END/
export function ps_error(text: string) {
    var result: {
        /** error message */
        message?: string,
        /**
         * Filter out the remaining text of the error message
         */
        rest: string
    } = { rest: text }
    const match = text.match(errorMatcher)
    if (match) {
        result.message = match[1]
            .split(/\r?\n/)
            .map(v => v.trim())
            .filter(v => v.length)
            .join(' ')
        result.rest = text.replace(match[0], '')
    }
    result.rest = result.rest.trim()
    return result
}