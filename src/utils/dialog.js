import { CoreUtility } from "./core.js";

/**
 * Utility class for handing configuration dialogs.
 */
export class DialogUtility {
    static async getConfirmDialog(title, options = {}) {
        const DialogV2 = foundry?.applications?.api?.DialogV2;

        if (DialogV2?.confirm) {
            const position = {
                width: options?.width ?? 400
            };
            if (Number.isFinite(options?.top)) position.top = options.top;
            if (Number.isFinite(options?.left)) position.left = options.left;

            return DialogV2.confirm({
                title,
                content: "",
                position,
                yes: {
                    label: CoreUtility.localize("Yes"),
                    icon: "fa-solid fa-check",
                    callback: () => true
                },
                no: {
                    label: CoreUtility.localize("No"),
                    icon: "fa-solid fa-xmark",
                    callback: () => false,
                    default: true
                }
            });
        }

        return new Promise(resolve => {
            const data = {
                title,
                content: "",
                buttons: {
                    yes: {
                        icon: '<i class="fa-solid fa-check"></i>',
                        label: CoreUtility.localize("Yes"),
                        callback: () => { resolve(true); }
                    },
                    no: {
                        icon: '<i class="fa-solid fa-xmark"></i>',
                        label: CoreUtility.localize("No"),
                        callback: () => { resolve(false); }
                    }
                },
                default: "yes",
                close: () => resolve(false)
            }

            new Dialog(data, options).render(true);
        });
    }
}
