export namespace main {
	
	export class CopyResult {
	    copied: string[];
	    errors: string[];
	
	    static createFrom(source: any = {}) {
	        return new CopyResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.copied = source["copied"];
	        this.errors = source["errors"];
	    }
	}
	export class OpenTarget {
	    rel: string;
	    root: string;
	    rootChanged: boolean;
	    error: string;
	
	    static createFrom(source: any = {}) {
	        return new OpenTarget(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.rel = source["rel"];
	        this.root = source["root"];
	        this.rootChanged = source["rootChanged"];
	        this.error = source["error"];
	    }
	}
	export class TreeNode {
	    name: string;
	    path: string;
	    isDir: boolean;
	    children?: TreeNode[];
	
	    static createFrom(source: any = {}) {
	        return new TreeNode(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	        this.isDir = source["isDir"];
	        this.children = this.convertValues(source["children"], TreeNode);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

