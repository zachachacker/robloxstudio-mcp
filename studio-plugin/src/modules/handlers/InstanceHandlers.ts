import Utils from "../Utils";

const ChangeHistoryService = game.GetService("ChangeHistoryService");
const InsertService = game.GetService("InsertService");

const { getInstancePath, getInstanceByPath, convertPropertyValue } = Utils;

function createObject(requestData: Record<string, unknown>) {
	const className = requestData.className as string;
	const parentPath = requestData.parent as string;
	const name = requestData.name as string | undefined;
	const properties = (requestData.properties as Record<string, unknown>) ?? {};

	if (!className || !parentPath) {
		return { error: "Class name and parent are required" };
	}

	const parentInstance = getInstanceByPath(parentPath);
	if (!parentInstance) return { error: `Parent instance not found: ${parentPath}` };

	const [success, newInstance] = pcall(() => {
		const instance = new Instance(className as keyof CreatableInstances);
		if (name) instance.Name = name;

		for (const [propertyName, propertyValue] of pairs(properties)) {
			pcall(() => {
				(instance as unknown as { [key: string]: unknown })[propertyName as string] = propertyValue;
			});
		}

		instance.Parent = parentInstance;
		ChangeHistoryService.SetWaypoint(`Create ${className}`);
		return instance;
	});

	if (success && newInstance) {
		return {
			success: true,
			className,
			parent: parentPath,
			instancePath: getInstancePath(newInstance as Instance),
			name: (newInstance as Instance).Name,
			message: "Object created successfully",
		};
	} else {
		return { error: `Failed to create object: ${newInstance}`, className, parent: parentPath };
	}
}

function deleteObject(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	if (!instancePath) return { error: "Instance path is required" };

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}` };
	if (instance === game) return { error: "Cannot delete the game instance" };

	const [success, result] = pcall(() => {
		const name = instance.Name;
		const className = instance.ClassName;
		instance.Destroy();
		ChangeHistoryService.SetWaypoint(`Delete ${className} (${name})`);
		return true;
	});

	if (success) {
		return { success: true, instancePath, message: "Object deleted successfully" };
	} else {
		return { error: `Failed to delete object: ${result}`, instancePath };
	}
}

function massCreateObjects(requestData: Record<string, unknown>) {
	const objects = requestData.objects as Record<string, unknown>[];
	if (!objects || !typeIs(objects, "table") || (objects as defined[]).size() === 0) {
		return { error: "Objects array is required" };
	}

	const results: Record<string, unknown>[] = [];
	let successCount = 0;
	let failureCount = 0;

	for (const objData of objects) {
		const className = objData.className as string;
		const parentPath = objData.parent as string;
		const name = objData.name as string | undefined;

		if (className && parentPath) {
			const parentInstance = getInstanceByPath(parentPath);
			if (parentInstance) {
				const [success, newInstance] = pcall(() => {
					const instance = new Instance(className as keyof CreatableInstances);
					if (name) instance.Name = name;
					instance.Parent = parentInstance;
					return instance;
				});

				if (success && newInstance) {
					successCount++;
					results.push({
						success: true, className, parent: parentPath,
						instancePath: getInstancePath(newInstance as Instance),
						name: (newInstance as Instance).Name,
					});
				} else {
					failureCount++;
					results.push({ success: false, className, parent: parentPath, error: tostring(newInstance) });
				}
			} else {
				failureCount++;
				results.push({ success: false, className, parent: parentPath, error: "Parent instance not found" });
			}
		} else {
			failureCount++;
			results.push({ success: false, error: "Class name and parent are required" });
		}
	}

	if (successCount > 0) ChangeHistoryService.SetWaypoint("Mass create objects");
	return { results, summary: { total: (objects as defined[]).size(), succeeded: successCount, failed: failureCount } };
}

function massCreateObjectsWithProperties(requestData: Record<string, unknown>) {
	const objects = requestData.objects as Record<string, unknown>[];
	if (!objects || !typeIs(objects, "table") || (objects as defined[]).size() === 0) {
		return { error: "Objects array is required" };
	}

	const results: Record<string, unknown>[] = [];
	let successCount = 0;
	let failureCount = 0;

	for (const objData of objects) {
		const className = objData.className as string;
		const parentPath = objData.parent as string;
		const name = objData.name as string | undefined;
		const properties = (objData.properties as Record<string, unknown>) ?? {};

		if (className && parentPath) {
			const parentInstance = getInstanceByPath(parentPath);
			if (parentInstance) {
				const [success, newInstance] = pcall(() => {
					const instance = new Instance(className as keyof CreatableInstances);
					if (name) instance.Name = name;
					instance.Parent = parentInstance;

					for (const [propName, propValue] of pairs(properties)) {
						pcall(() => {
							const converted = convertPropertyValue(instance, propName as string, propValue);
							if (converted !== undefined) {
								(instance as unknown as { [key: string]: unknown })[propName as string] = converted;
							}
						});
					}
					return instance;
				});

				if (success && newInstance) {
					successCount++;
					results.push({
						success: true, className, parent: parentPath,
						instancePath: getInstancePath(newInstance as Instance),
						name: (newInstance as Instance).Name,
					});
				} else {
					failureCount++;
					results.push({ success: false, className, parent: parentPath, error: tostring(newInstance) });
				}
			} else {
				failureCount++;
				results.push({ success: false, className, parent: parentPath, error: "Parent instance not found" });
			}
		} else {
			failureCount++;
			results.push({ success: false, error: "Class name and parent are required" });
		}
	}

	if (successCount > 0) ChangeHistoryService.SetWaypoint("Mass create objects with properties");
	return { results, summary: { total: (objects as defined[]).size(), succeeded: successCount, failed: failureCount } };
}

function smartDuplicate(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	const count = requestData.count as number;
	const options = (requestData.options as Record<string, unknown>) ?? {};

	if (!instancePath || !count || count < 1) {
		return { error: "Instance path and count > 0 are required" };
	}

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}` };

	const results: Record<string, unknown>[] = [];
	let successCount = 0;
	let failureCount = 0;

	for (let i = 1; i <= count; i++) {
		const [success, newInstance] = pcall(() => {
			const clone = instance.Clone();

			if (options.namePattern) {
				clone.Name = (options.namePattern as string).gsub("{n}", tostring(i))[0];
			} else {
				clone.Name = instance.Name + i;
			}

			if (options.positionOffset && clone.IsA("BasePart")) {
				const offset = options.positionOffset as number[];
				const currentPos = clone.Position;
				clone.Position = new Vector3(
					currentPos.X + ((offset[0] ?? 0) as number) * i,
					currentPos.Y + ((offset[1] ?? 0) as number) * i,
					currentPos.Z + ((offset[2] ?? 0) as number) * i,
				);
			}

			if (options.rotationOffset && clone.IsA("BasePart")) {
				const offset = options.rotationOffset as number[];
				clone.CFrame = clone.CFrame.mul(CFrame.Angles(
					math.rad(((offset[0] ?? 0) as number) * i),
					math.rad(((offset[1] ?? 0) as number) * i),
					math.rad(((offset[2] ?? 0) as number) * i),
				));
			}

			if (options.scaleOffset && clone.IsA("BasePart")) {
				const offset = options.scaleOffset as number[];
				const currentSize = clone.Size;
				clone.Size = new Vector3(
					currentSize.X * (((offset[0] ?? 1) as number) ** i),
					currentSize.Y * (((offset[1] ?? 1) as number) ** i),
					currentSize.Z * (((offset[2] ?? 1) as number) ** i),
				);
			}

			if (options.propertyVariations) {
				for (const [propName, values] of pairs(options.propertyVariations as Record<string, unknown[]>)) {
					if (values && (values as defined[]).size() > 0) {
						const valueIndex = ((i - 1) % (values as defined[]).size());
						pcall(() => {
							(clone as unknown as { [key: string]: unknown })[propName as string] = (values as unknown[])[valueIndex];
						});
					}
				}
			}

			const targetParents = options.targetParents as string[] | undefined;
			if (targetParents && targetParents[i - 1]) {
				const targetParent = getInstanceByPath(targetParents[i - 1]);
				clone.Parent = targetParent ?? instance.Parent;
			} else {
				clone.Parent = instance.Parent;
			}

			return clone;
		});

		if (success && newInstance) {
			successCount++;
			results.push({
				success: true,
				instancePath: getInstancePath(newInstance as Instance),
				name: (newInstance as Instance).Name,
				index: i,
			});
		} else {
			failureCount++;
			results.push({ success: false, index: i, error: tostring(newInstance) });
		}
	}

	if (successCount > 0) {
		ChangeHistoryService.SetWaypoint(`Smart duplicate ${instance.Name} (${successCount} copies)`);
	}

	return {
		results,
		summary: { total: count, succeeded: successCount, failed: failureCount },
		sourceInstance: instancePath,
	};
}

function massDuplicate(requestData: Record<string, unknown>) {
	const duplications = requestData.duplications as Record<string, unknown>[];
	if (!duplications || !typeIs(duplications, "table") || (duplications as defined[]).size() === 0) {
		return { error: "Duplications array is required" };
	}

	const allResults: Record<string, unknown>[] = [];
	let totalSuccess = 0;
	let totalFailures = 0;

	for (const duplication of duplications) {
		const result = smartDuplicate(duplication) as { summary?: { succeeded: number; failed: number } };
		allResults.push(result as unknown as Record<string, unknown>);
		if (result.summary) {
			totalSuccess += result.summary.succeeded;
			totalFailures += result.summary.failed;
		}
	}

	if (totalSuccess > 0) {
		ChangeHistoryService.SetWaypoint(`Mass duplicate operations (${totalSuccess} objects)`);
	}

	return {
		results: allResults,
		summary: { total: totalSuccess + totalFailures, succeeded: totalSuccess, failed: totalFailures },
	};
}

function reparentInstance(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	const newParentPath = requestData.newParent as string;

	if (!instancePath) return { error: "Instance path is required" };
	if (!newParentPath) return { error: "New parent path is required" };

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}` };

	const newParent = getInstanceByPath(newParentPath);
	if (!newParent) return { error: `New parent not found: ${newParentPath}` };

	const [success, result] = pcall(() => {
		const oldParentPath = instance.Parent ? getInstancePath(instance.Parent) : "none";
		instance.Parent = newParent;
		ChangeHistoryService.SetWaypoint(`Reparent ${instance.Name} to ${newParent.Name}`);
		return oldParentPath;
	});

	if (success) {
		return {
			success: true,
			instancePath: getInstancePath(instance),
			oldParent: result,
			newParent: newParentPath,
			message: `Instance reparented successfully`,
		};
	} else {
		return { error: `Failed to reparent instance: ${result}` };
	}
}

function undo(_requestData: Record<string, unknown>) {
	const [success, result] = pcall(() => {
		ChangeHistoryService.Undo();
		return true;
	});

	if (success) {
		return { success: true, message: "Undo performed successfully" };
	} else {
		return { error: `Failed to undo: ${result}` };
	}
}

function redo(_requestData: Record<string, unknown>) {
	const [success, result] = pcall(() => {
		ChangeHistoryService.Redo();
		return true;
	});

	if (success) {
		return { success: true, message: "Redo performed successfully" };
	} else {
		return { error: `Failed to redo: ${result}` };
	}
}

function insertAsset(requestData: Record<string, unknown>) {
	const assetId = requestData.assetId as number;
	const parentPath = requestData.parent as string;

	if (!assetId) return { error: "Asset ID is required" };
	if (!parentPath) return { error: "Parent path is required" };

	const parentInstance = getInstanceByPath(parentPath);
	if (!parentInstance) return { error: `Parent not found: ${parentPath}` };

	const [success, result] = pcall(() => {
		const model = InsertService.LoadAsset(assetId);
		const inserted: string[] = [];

		for (const child of model.GetChildren()) {
			child.Parent = parentInstance;
			inserted.push(getInstancePath(child));
		}

		model.Destroy();
		ChangeHistoryService.SetWaypoint(`Insert asset ${assetId}`);
		return inserted;
	});

	if (success) {
		return {
			success: true,
			assetId,
			parent: parentPath,
			insertedInstances: result,
			message: "Asset inserted successfully",
		};
	} else {
		return { error: `Failed to insert asset: ${result}`, assetId, parent: parentPath };
	}
}

function cloneInstance(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	const parentPath = requestData.parent as string;
	const name = requestData.name as string | undefined;

	if (!instancePath) return { error: "Instance path is required" };
	if (!parentPath) return { error: "Parent path is required" };

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}` };

	const parentInstance = getInstanceByPath(parentPath);
	if (!parentInstance) return { error: `Parent not found: ${parentPath}` };

	const [success, newInstance] = pcall(() => {
		const clone = instance.Clone();
		if (name) clone.Name = name;
		clone.Parent = parentInstance;
		ChangeHistoryService.SetWaypoint(`Clone ${instance.Name}`);
		return clone;
	});

	if (success && newInstance) {
		return {
			success: true,
			sourceInstance: instancePath,
			newInstancePath: getInstancePath(newInstance as Instance),
			name: (newInstance as Instance).Name,
			parent: parentPath,
			message: "Instance cloned successfully",
		};
	} else {
		return { error: `Failed to clone instance: ${newInstance}`, instancePath, parent: parentPath };
	}
}

function createUI(requestData: Record<string, unknown>) {
	const elements = requestData.elements as Record<string, unknown>[];
	const defaultParent = (requestData.parent as string) ?? "game.StarterGui";

	if (!elements || !typeIs(elements, "table") || (elements as defined[]).size() === 0) {
		return { error: "Elements array is required" };
	}

	const results: Record<string, unknown>[] = [];
	let successCount = 0;
	let failureCount = 0;

	for (const elemData of elements) {
		const className = elemData.className as string;
		const elemName = elemData.name as string | undefined;
		const position = elemData.position as Record<string, number> | undefined;
		const elemSize = elemData.size as Record<string, number> | undefined;
		const properties = (elemData.properties as Record<string, unknown>) ?? {};
		const parentPath = (elemData.parent as string) ?? defaultParent;

		if (!className) {
			failureCount++;
			results.push({ success: false, error: "className is required" });
			continue;
		}

		const parentInstance = getInstanceByPath(parentPath);
		if (!parentInstance) {
			failureCount++;
			results.push({ success: false, className, error: `Parent not found: ${parentPath}` });
			continue;
		}

		const [success, newInstance] = pcall(() => {
			const instance = new Instance(className as keyof CreatableInstances);
			if (elemName) instance.Name = elemName;

			if (position) {
				(instance as unknown as { Position: UDim2 }).Position = new UDim2(
					position.xScale ?? 0, position.xOffset ?? 0,
					position.yScale ?? 0, position.yOffset ?? 0,
				);
			}

			if (elemSize) {
				(instance as unknown as { Size: UDim2 }).Size = new UDim2(
					elemSize.xScale ?? 0, elemSize.xOffset ?? 0,
					elemSize.yScale ?? 0, elemSize.yOffset ?? 0,
				);
			}

			for (const [propName, propValue] of pairs(properties)) {
				pcall(() => {
					const converted = convertPropertyValue(instance, propName as string, propValue);
					if (converted !== undefined) {
						(instance as unknown as { [key: string]: unknown })[propName as string] = converted;
					}
				});
			}

			instance.Parent = parentInstance;
			return instance;
		});

		if (success && newInstance) {
			successCount++;
			results.push({
				success: true,
				className,
				instancePath: getInstancePath(newInstance as Instance),
				name: (newInstance as Instance).Name,
			});
		} else {
			failureCount++;
			results.push({ success: false, className, error: tostring(newInstance) });
		}
	}

	if (successCount > 0) ChangeHistoryService.SetWaypoint("Create UI elements");
	return {
		results,
		summary: { total: (elements as defined[]).size(), succeeded: successCount, failed: failureCount },
	};
}

export = {
	createObject,
	deleteObject,
	massCreateObjects,
	massCreateObjectsWithProperties,
	smartDuplicate,
	massDuplicate,
	reparentInstance,
	undo,
	redo,
	insertAsset,
	cloneInstance,
	createUI,
};
