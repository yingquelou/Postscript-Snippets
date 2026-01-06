import * as chevrotain from 'chevrotain';

function isCstNode(element: chevrotain.CstElement): element is chevrotain.CstNode {
    return 'name' in element;
}
/**
 * Deconstruct `postscript` rule `expression`
 */
function derefexpression(element: chevrotain.CstElement) {
    if (isCstNode(element) && element.name === 'expression') {
        const children = element.children
        for (const name in children)
            return children[name][0]
    }
    return element
}
/**
 * Grammar tree node path management, used to locate the current node
 */
class CstNodePath {
    nodes: chevrotain.CstElement[];
    parent?: CstNodePath;
    index: number;
    constructor({ nodes, parent, index }
        : { nodes: chevrotain.CstElement[], parent?: CstNodePath, index: number }) {
        this.nodes = nodes
        this.index = index
        this.parent = parent
    }
    get node() {
        return derefexpression(this.nodes[this.index])
    }
    get children(): chevrotain.CstElement[] | undefined {
        const node = this.node
        if (isCstNode(node)) {
            switch (node.name) {
                case 'dictionary':
                case 'array':
                    return node.children.expression
            }
        }
    }
}

/**
 * Syntax Tree Traverser: Tracks the position of syntax tree nodes to implement debugger stepping logic
 */
export class CstWalker {
    private root: chevrotain.CstNode;
    private currentPath?: CstNodePath;
    private programText: string;
    constructor(cst: chevrotain.CstNode, programText: string) {
        this.root = cst;
        this.programText = programText;
        const expression = cst.children.expression
        if (expression && expression.length > 0) {
            this.currentPath = new CstNodePath({
                nodes: expression,
                index: 0
            })
        }
    }

    getNodeText(node: chevrotain.CstElement): string {
        if (isCstNode(node)) {
            if (node.location && node.location.endOffset) {
                return this.programText.substring(node.location.startOffset, node.location.endOffset + 1)
            }
        } else {
            return node.image
        }
        return '';
    }

    getCurrentNodeText(): string {
        if (this.currentPath)
            return this.getNodeText(this.currentPath.node);
        return ''
    }

    /**
     * Get the start marker of a dictionary or array (<< or [)
     * Used to send the start marker to the interpreter when the debugger `StepIn` request is made
     */
    getStartToken(): string {
        if (this.currentPath) {
            const node = this.currentPath.node
            if (isCstNode(node)) {
                switch (node.name) {
                    case 'dictionary':
                        return (node.children.DictionaryStart[0] as chevrotain.IToken).image
                    case 'array':
                        return (node.children.ArrayStart[0] as chevrotain.IToken).image
                }
            }
        }
        return '';
    }

    /**
     * Get the source file content location corresponding to the node
     */
    getLocationWithCstElement(node?: chevrotain.CstElement | null): chevrotain.CstNodeLocation | undefined {
        if (node) {
            if (isCstNode(node)) {
                if (node.location) {
                    return node.location
                }
            } else {
                return node
            }
        }
    }
    /**
     * @see {@link getLocationWithCstElement}
     */
    getCurrentLocation(): chevrotain.CstNodeLocation {
        return this.getLocationWithCstElement(this.currentPath?.node) || { startOffset: this.programText.length }
    }

    /**
     * Next: Move to the next sibling node. If it is already the last sibling node, perform StepOut.
     */
    next(): string {
        if (this.currentPath) {
            const nodes = this.currentPath.nodes;
            const newIndex = this.currentPath.index + 1
            if (newIndex < nodes.length) {
                const text = this.getCurrentNodeText()
                // 有下一个兄弟节点
                this.currentPath.index = newIndex
                return text
            } else return this.stepOut()
        }
        return ''
    }
    /**
     * StepIn: Enter the first child node of the current node.
     * If there are no child nodes, execute Next. 
     * Note: `procedure` nodes do not allow StepIn and will directly execute Next.
     */
    stepIn(): string {
        if (this.currentPath) {
            const children = this.currentPath.children
            if (children) {
                const text = this.getStartToken()
                this.currentPath = new CstNodePath({
                    parent: this.currentPath,
                    nodes: children,
                    index: 0
                })
                return text
            } else {
                return this.next()
            }
        }
        return '';
    }
    private getParentPathForstepOut(path?: CstNodePath | null): CstNodePath | undefined {
        while (path) {
            if (path.index + 1 < path.nodes.length) {
                return path
            } else path = path.parent
        }
    }
    /**
     * StepOut: After processing the remaining sibling nodes, return to the parent node's sibling nodes
     */
    stepOut(): string {
        const startOffset = this.getLocationWithCstElement(this.currentPath?.node)?.startOffset
        if (startOffset !== undefined) {
            const path = this.getParentPathForstepOut(this.currentPath?.parent)
            if (path) {
                const parentLocation = this.getLocationWithCstElement(path.node)
                path.index++
                this.currentPath = path
                return this.programText.substring(startOffset, (parentLocation && parentLocation.endOffset && parentLocation.endOffset + 1))
            }
            else {
                this.currentPath = undefined
                return this.programText.substring(startOffset)
            }
        }
        return ''
    }
}