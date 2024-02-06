'use strict';

import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import { resolve, join } from 'path';

export default class Helpers {

	static wordMatchRegex = /[\w\d\-_\.\:\\\/@]+/g;
	static phpParser:any = null;
	static cachedParseFunction:any = null;
	static modelsCache: Array<string>;
	static modelsCacheTime: number = 0;
	static outputChannel: vscode.OutputChannel|null = null;

	static tags:any = {
		config: 	{classes: ['Config']	, functions: ['config']},
		mix: 		{classes: []			, functions: ['mix']},
		route: 		{classes: ['Route']		, functions: ['route', 'signedRoute']},
		trans: 		{classes: ['Lang']		, functions: ['__', 'trans', '@lang']},
		validation:	{classes: ['Validator'] , functions: ['validate', 'sometimes', 'rules']},
		view: 		{classes: ['View']		, functions: ['view', 'markdown', 'links', '@extends', '@component', '@include', '@each']},
		env: 		{classes: []			, functions: ['env']},
		auth: 		{classes: ['Gate']		, functions: ['can', '@can', '@cannot', '@canany']},
		asset: 		{classes: []			, functions: ['asset']},
		model:		{classes: []			, functions: []},
	};
	static functionRegex: any = null;

	static relationMethods =  ['has', 'orHas', 'whereHas', 'orWhereHas', 'whereDoesntHave', 'orWhereDoesntHave',
							   'doesntHave', 'orDoesntHave', 'hasMorph', 'orHasMorph', 'doesntHaveMorph', 'orDoesntHaveMorph',
							   'whereHasMorph', 'orWhereHasMorph', 'whereDoesntHaveMorph', 'orWhereDoesntHaveMorph',
							   'withAggregate', 'withCount', 'withMax', 'withMin', 'withSum', 'withAvg'];

	/**
     * Create a full path from a project-relative path, considering settings for code and general use.
     * @param path The relative path within the project to resolve.
     * @param forCode Indicates whether the path is used for code purposes, affecting which basePath setting is used.
     * @returns The resolved full path as a string.
     */
	static projectPath(path: string, forCode: boolean = false): string {
		// Determine the appropriate base path setting based on the context (code or general).
		const configKey = forCode ? 'basePathForCode' : 'basePath';
		const basePathSetting = vscode.workspace.getConfiguration("LaravelExtraIntellisense").get<string>(configKey);

		if (basePathSetting) {
			const resolvedBasePath = this.resolveBasePath(basePathSetting);
			// Use path.join to automatically handle different OS path delimiters and avoid manual string concatenation.
			return join(resolvedBasePath, path);
		}

		// Fallback to searching for the artisan file in workspace folders to determine the Laravel project root.
		return this.findArtisanPath(path);
	}

	/**
     * Resolves the base path from the configuration, accounting for relative paths.
     * @param basePathSetting The base path setting from the configuration.
     * @returns The resolved base path as an absolute path.
     */
    private static resolveBasePath(basePathSetting: string): string {
        if (basePathSetting.startsWith('.')) {
            // Assume the first workspace folder if available; this might need refinement for multi-root workspaces.
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (workspaceFolder) {
                return resolve(workspaceFolder, basePathSetting);
            }
        }
        // For absolute paths or non-relative settings, return as is.
        return basePathSetting;
    }

	/**
     * Searches workspace folders for the Laravel artisan file and returns the path concatenated with the given path.
     * @param path The relative path to append to the found artisan base path.
     * @returns The full path based on the artisan file's location, or an empty string if not found.
     */
	private static findArtisanPath(path: string): string {
		if (vscode.workspace.workspaceFolders) {
			for (let workspaceFolder of vscode.workspace.workspaceFolders) {
				const artisanPath = join(workspaceFolder.uri.fsPath, 'artisan');
				if (fs.existsSync(artisanPath)) {
					return join(workspaceFolder.uri.fsPath, path);
				}
			}
		}
		return "";
	}


	static arrayUnique(value:any, index:any, self:Array<any>) {
		return self.indexOf(value) === index;
	}

	/**
	 * Boot laravel and run simple php code.
	 *
	 * @param code
	 */
	static runLaravel(code: string) : Promise<string> {
		code = code.replace(/(?:\r\n|\r|\n)/g, ' ');
		if (fs.existsSync(Helpers.projectPath("vendor/autoload.php")) && fs.existsSync(Helpers.projectPath("bootstrap/app.php"))) {
			var command =
				"define('LARAVEL_START', microtime(true));" +
				"require_once '" + Helpers.projectPath("vendor/autoload.php", true) + "';" +
				"$app = require_once '" + Helpers.projectPath("bootstrap/app.php", true) + "';" +
				"class VscodeLaravelExtraIntellisenseProvider extends \\Illuminate\\Support\\ServiceProvider" +
				"{" +
				"   public function register() {}" +
				"	public function boot()" +
				"	{" +
				"       if (method_exists($this->app['log'], 'setHandlers')) {" +
				"			$this->app['log']->setHandlers([new \\Monolog\\Handler\\NullHandler()]);" +
				"		}" +
				"	}" +
				"}" +
				"$app->register(new VscodeLaravelExtraIntellisenseProvider($app));" +
				"$kernel = $app->make(Illuminate\\Contracts\\Console\\Kernel::class);" +

				"$status = $kernel->handle(" +
					"$input = new Symfony\\Component\\Console\\Input\\ArgvInput," +
					"new Symfony\\Component\\Console\\Output\\ConsoleOutput" +
				");" +
				"echo '___VSCODE_LARAVEL_EXTRA_INSTELLISENSE_OUTPUT___';" +
				 code +
				"echo '___VSCODE_LARAVEL_EXTRA_INSTELLISENSE_END_OUTPUT___';";

			var self = this;

			return new Promise(function (resolve, error) {
				self.runPhp(command)
					.then(function (result: string) {
						var out : string | null | RegExpExecArray = result;
						out = /___VSCODE_LARAVEL_EXTRA_INSTELLISENSE_OUTPUT___(.*)___VSCODE_LARAVEL_EXTRA_INSTELLISENSE_END_OUTPUT___/g.exec(out);
						if (out) {
							resolve(out[1]);
						} else {
							error("PARSE ERROR: " + result);
						}
					})
					.catch(function (e : Error) {
						error(e);
					});
			});
		}
		return new Promise((resolve, error) => resolve(""));
	}

	/**
	 * run simple php code.
	 *
	 * @param code
	 */
	static async runPhp(code: string) : Promise<string> {
		code = code.replace(/\"/g, "\\\"");
		if (['linux', 'openbsd', 'sunos', 'darwin'].some(unixPlatforms => os.platform().includes(unixPlatforms))) {
			code = code.replace(/\$/g, "\\$");
			code = code.replace(/\\\\'/g, '\\\\\\\\\'');
			code = code.replace(/\\\\"/g, '\\\\\\\\\"');
		}
		let command = vscode.workspace.getConfiguration("LaravelExtraIntellisense").get<string>('phpCommand') ?? "php -r \"{code}\"";
		command = command.replace("{code}", code);
		let out = new Promise<string>(function (resolve, error) {
			cp.exec(command,
				{ cwd: vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0 ? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined },
				function (err, stdout, stderr) {
					if (stdout.length > 0) {
						resolve(stdout);
					} else {
						if (Helpers.outputChannel !== null) {
							Helpers.outputChannel.appendLine("Laravel extra intellisense Error: " + stderr);
						}
						error(stderr);
					}
				}
			);
		});
		return out;
	}

	/**
	 * Parse php code with 'php-parser' package.
	 * @param code
	 */
	static parsePhp(code: string): any {
		if (! Helpers.phpParser) {
			var PhpEngine = require('php-parser');
			Helpers.phpParser = new PhpEngine({
				parser: {
					extractDoc: true,
					php7: true
				},
				ast: {
				  withPositions: true
				}
			});
		}
		try {
			return Helpers.phpParser.parseCode(code);
		} catch (exception) {
			return null;
		}
	}

	/**
	 * Convert php variable defination to javascript variable.
	 * @param code
	 */
	static evalPhp(code: string): any {
		var out = Helpers.parsePhp('<?php ' + code + ';');
		if (out && typeof out.children[0] !== 'undefined') {
			return out.children[0].expression.value;
		}
		return undefined;
	}

	/**
	 * Parse php function call.
	 *
	 * @param text
	 * @param position
	 */
	static parseFunction(text: string, position: number, level: number = 0): any {
		var out:any = null;
		var classes = [];
		for(let i in Helpers.tags) {
			for (let j in Helpers.tags[i].classes) {
				classes.push(Helpers.tags[i].classes[j]);
			}
		}
		var regexPattern = "(((" + classes.join('|') + ")::)?([@A-Za-z0-9_]+))((\\()((?:[^)(]|\\((?:[^)(]|\\([^)(]*\\))*\\))*)(\\)|$))";
		var functionRegex = new RegExp(regexPattern, "g");
		var paramsRegex = /((\s*\,\s*)?)(\[[\s\S]*(\]|$)|array\[\s\S]*(\)|$)|(\"((\\\")|[^\"])*(\"|$))|(\'((\\\')|[^\'])*(\'|$)))/g;
		var inlineFunctionMatch = /\((([\s\S]*\,)?\s*function\s*\(.*\)\s*\{)([\S\s]*)\}/g;

		text = text.substr(Math.max(0, position - 200), 400);
		position -= Math.max(0, position - 200);

		var match = null;
		var match2 = null;
		if (Helpers.cachedParseFunction !== null && Helpers.cachedParseFunction.text === text && position === Helpers.cachedParseFunction.position) {
			out = Helpers.cachedParseFunction.out;
		} else if (level < 6) {
			while ((match = functionRegex.exec(text)) !== null) {
				if (position >= match.index && match[0] && position < match.index + match[0].length) {
					if ((match2 = inlineFunctionMatch.exec(match[0])) !== null && typeof match2[3] === 'string' && typeof match[1] === 'string' && typeof match[6] === 'string' && typeof match2[1] === 'string') {
						out = this.parseFunction(match2[3], position - (match.index + match[1].length + match[6].length + match2[1].length), level + 1);
					} else if (typeof match[1] === 'string' && typeof match[6]=== 'string' && typeof match[7]=== 'string') {
						var textParameters = [];
						var paramIndex = null;
						var paramIndexCounter = 0;
						var paramsPosition = position - (match.index + match[1].length + match[6].length);

						var functionInsideParameter;
						if (match[7].length >= 4 && (functionInsideParameter = this.parseFunction(match[7], paramsPosition))) {
							return functionInsideParameter;
						}

						while ((match2 = paramsRegex.exec(match[7])) !== null) {
							textParameters.push(match2[3]);
							if (paramsPosition >= match2.index && typeof match2[0] === 'string' && paramsPosition <= match2.index + match2[0].length) {
								paramIndex = paramIndexCounter;
							}
							paramIndexCounter++;
						}
						var functionParametrs = [];
						for (let i in textParameters) {
							functionParametrs.push(this.evalPhp(textParameters[i]));
						}
						out = {
							class: match[3],
							function: match[4],
							paramIndex: paramIndex,
							parameters: functionParametrs,
							textParameters: textParameters
						};
					}
					if (level === 0) {
						Helpers.cachedParseFunction = {text, position, out};
					}
				}
			}
		}
		return out;
	}

	/**
	 * Parse php function call from vscode editor.
	 *
	 * @param document
	 * @param position
	 */
	static parseDocumentFunction(document: vscode.TextDocument, position: vscode.Position) {
        var pos = document.offsetAt(position);
        return Helpers.parseFunction(document.getText(), pos);
	}

	/**
	 * Get laravel models as array.
	 *
	 * @returns array<string>
	 */
	static getModels() : Promise<Array<string>> {
		var self = this;
		return new Promise<Array<string>>(function (resolve, reject) {
			if (Math.floor(Date.now()/1000) - self.modelsCacheTime < 60) {
				return resolve(self.modelsCache);
			} else {
				Helpers.runLaravel(`
					echo json_encode(array_values(array_filter(array_map(function ($name) {return app()->getNamespace().str_replace([app_path().'/', app_path().'\\\\', '.php', '/'], ['', '', '', '\\\\'], $name);}, array_merge(glob(app_path('*')), glob(app_path('Models/*')))), function ($class) {
						return class_exists($class) && is_subclass_of($class, 'Illuminate\\\\Database\\\\Eloquent\\\\Model');
					})));
				`).then(function (result) {
					var models = JSON.parse(result);
					self.modelsCache = models;
					resolve(models);
				})
				.catch(function (error) {
					console.error(error);
					resolve([]);
				});
			}
		});
	}

	/**
	 * Get indent space based on user configuration
	 */
	 static getSpacer() : string {
		const editor = vscode.window.activeTextEditor;
		if (editor && editor.options.insertSpaces) {
			return ' '.repeat(<number>editor.options.tabSize);
		}
		return '\t';
	}
}
