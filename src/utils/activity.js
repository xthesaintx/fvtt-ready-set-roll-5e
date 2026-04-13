import { MODULE_SHORT } from "../module/const.js";
import { MODULE_MIDI } from "../module/integration.js";
import { ChatUtility } from "./chat.js";
import { CoreUtility } from "./core.js";
import { ROLL_TYPE } from "./roll.js";
import { SETTING_NAMES, SettingsUtility } from "./settings.js";

export class ActivityUtility {

    static _getActivityFromMessage(message) {
        if (typeof message.getAssociatedActivity === "function") {
            const act = message.getAssociatedActivity();
            if (act) return act;
        }

        
        
        
        let item = null;
        if (typeof message.getAssociatedItem === "function") item = message.getAssociatedItem();
        if (!item && message.flags?.dnd5e?.item?.uuid) item = fromUuidSync(message.flags.dnd5e.item.uuid, { strict: false });
        if (!item && message.flags?.dnd5e?.use?.itemUuid) item = fromUuidSync(message.flags.dnd5e.use.itemUuid, { strict: false });

        const activityId = message.flags?.dnd5e?.activity?.id;
        if (item && activityId) {
            const act = item.system?.activities?.get(activityId);
            if (act) return act;
        }

        
        
        
        const activityUuid = message.flags?.dnd5e?.activity?.uuid;
        if (activityUuid) {
            const act = fromUuidSync(activityUuid, { strict: false });
            if (act) return act;
        }

        return null;
    }


    static _getActorFromMessage(message) {
        return ChatUtility.getActorFromMessage(message);
    }


    static _extractRolls(result) {
        let extracted = [];
        if (!result) return extracted;
        const items = Array.isArray(result) ? result : [result];
        for (const item of items) {
            if (!item) continue;
            if (item instanceof Roll) {
                extracted.push(item);
            } else if (item.rolls && Array.isArray(item.rolls)) {
                extracted.push(...item.rolls);
            } else if (item.roll && item.roll instanceof Roll) {
                extracted.push(item.roll);
            } else if (item.class && item.formula) {
                try { extracted.push(Roll.fromData(item)); } catch(e) {}
            }
        }
        return extracted;
    }


    static setRenderFlags(activity, message) {
        if (!message || !activity) return;
        const flags = message.flags;
        if (!flags || !flags[MODULE_SHORT] || !flags[MODULE_SHORT].quickRoll) return;

        const hasAttack  = activity.type === "attack"  || !!activity.attack   || activity.hasOwnProperty(ROLL_TYPE.ATTACK);
        const hasDamage  = activity.type === "damage"  || !!activity.damage   || activity.type === "attack" || activity.type === "save" || activity.hasOwnProperty(ROLL_TYPE.DAMAGE);
        const hasHealing = activity.type === "heal"    || !!activity.healing  || activity.hasOwnProperty(ROLL_TYPE.HEALING);
        const hasFormula = activity.type === "utility" || !!activity.roll     || activity.hasOwnProperty(ROLL_TYPE.FORMULA);

        if (hasAttack) {
            flags[MODULE_SHORT].renderAttack = true;
        }

        const manualDamageMode = SettingsUtility.getSettingValue(SETTING_NAMES.MANUAL_DAMAGE_MODE);

        if (hasDamage) {
            flags[MODULE_SHORT].manualDamage = (manualDamageMode === 2 || (manualDamageMode === 1 && hasAttack));
            flags[MODULE_SHORT].renderDamage = !flags[MODULE_SHORT].manualDamage;
        }

        if (hasHealing) {
            flags[MODULE_SHORT].isHealing = true;
            flags[MODULE_SHORT].renderDamage = true;
        }

        if (hasFormula) {
            flags[MODULE_SHORT].renderFormula = true;
            const fName = activity.roll?.name || activity[ROLL_TYPE.FORMULA]?.name;
            if (fName && fName !== "") {
                flags[MODULE_SHORT].formulaName = fName;
            }
        }
    }


    static async runActivityActions(message) {
        let currentRolls = Array.from(message.flags[MODULE_SHORT]?.rolls || []);

        if (message.flags[MODULE_SHORT].renderAttack) {
            const rawAttack = await ActivityUtility.getAttackFromMessage(message);
            const attackRolls = ActivityUtility._extractRolls(rawAttack);

            if (attackRolls.length > 0) {
                currentRolls = _injectRollsToArray(currentRolls, attackRolls, CONFIG.Dice.D20Roll);
                
                
                message.flags[MODULE_SHORT].isCritical = message.flags[MODULE_SHORT].dual
                    ? false
                    : attackRolls[0].isCritical;
            } else {
                message.flags[MODULE_SHORT].isCritical = false;
            }
        }

        if (message.flags[MODULE_SHORT].renderDamage) {
            const rawDamage = await ActivityUtility.getDamageFromMessage(message);
            const damageRolls = ActivityUtility._extractRolls(rawDamage);

            if (damageRolls.length > 0) {
                currentRolls = _injectRollsToArray(currentRolls, damageRolls, CONFIG.Dice.DamageRoll);
            }
        }

        if (message.flags[MODULE_SHORT].renderFormula) {
            const rawFormula = await ActivityUtility.getFormulaFromMessage(message);
            const formulaRolls = ActivityUtility._extractRolls(rawFormula);

            if (formulaRolls.length > 0) {
                currentRolls = _injectRollsToArray(currentRolls, formulaRolls, CONFIG.Dice.BasicRoll);
            }
        }

        message.flags[MODULE_SHORT].processed = true;
        message.flags[MODULE_SHORT].rolls = currentRolls.map(r => r.toJSON ? r.toJSON() : r);

        await ChatUtility.updateChatMessage(message, {
            flags: message.flags
        });
    }


    static async runActivityAction(message, action) {
        let currentRolls = Array.from(message.flags[MODULE_SHORT]?.rolls || []);

        switch (action) {
            case ROLL_TYPE.DAMAGE: {
                const rawDamage = await ActivityUtility.getDamageFromMessage(message);
                const damageRolls = ActivityUtility._extractRolls(rawDamage);

                if (damageRolls.length > 0) {
                    currentRolls = _injectRollsToArray(currentRolls, damageRolls, CONFIG.Dice.DamageRoll);
                }
                break;
            }
        }

        message.flags[MODULE_SHORT].rolls = currentRolls.map(r => r.toJSON ? r.toJSON() : r);

        await ChatUtility.updateChatMessage(message, {
            flags: message.flags
        });
    }

    static getAttackFromMessage(message) {
        const activity = ActivityUtility._getActivityFromMessage(message);
        if (!activity || typeof activity.rollAttack !== "function") return null;

        const config = {
            advantage:    message.flags[MODULE_SHORT].advantage    ?? false,
            disadvantage: message.flags[MODULE_SHORT].disadvantage ?? false,
            ammunition:   message.flags[MODULE_SHORT].ammunition
        };

        const dialogConfig  = { configure: false };
        const messageConfig = { create: false, data: { flags: {} }, flags: {} };
        messageConfig.data.flags[MODULE_SHORT] = { quickRoll: true };
        messageConfig.flags[MODULE_SHORT]      = { quickRoll: true };

        return activity.rollAttack(config, dialogConfig, messageConfig);
    }


    static getDamageFromMessage(message) {
        const activity = ActivityUtility._getActivityFromMessage(message);
        const actor    = ActivityUtility._getActorFromMessage(message);

        if (!activity || !actor || typeof activity.rollDamage !== "function") return null;

        
        const scaling = message.system?.scaling ?? message.flags?.dnd5e?.scaling ?? 0;

        
        
        activity.item.flags.dnd5e ??= {};
        if (activity.item.flags.dnd5e.scaling !== scaling) {
            activity.item.flags.dnd5e.scaling = scaling;
        }

        const config = {
            isCritical: message.flags[MODULE_SHORT].isCritical ?? false,
            
            ammunition: actor.items?.get(message.flags[MODULE_SHORT].ammunition),
            scaling,
            midiOptions: CoreUtility.hasModule(MODULE_MIDI)
                ? { isCritical: message.flags[MODULE_SHORT].isCritical ?? false }
                : undefined
        };

        const dialogConfig  = { configure: false };
        const messageConfig = { create: false, data: { flags: {} }, flags: {} };
        messageConfig.data.flags[MODULE_SHORT] = { quickRoll: true };
        messageConfig.flags[MODULE_SHORT]      = { quickRoll: true };

        return activity.rollDamage(config, dialogConfig, messageConfig);
    }


    static getFormulaFromMessage(message) {
        const activity = ActivityUtility._getActivityFromMessage(message);
        if (!activity || typeof activity.rollFormula !== "function") return null;

        const scaling = message.system?.scaling ?? message.flags?.dnd5e?.scaling ?? 0;

        activity.item.flags.dnd5e ??= {};
        if (activity.item.flags.dnd5e.scaling !== scaling) {
            activity.item.flags.dnd5e.scaling = scaling;
        }

        const config        = { scaling };
        const dialogConfig  = { configure: false };
        const messageConfig = { create: false, data: { flags: {} }, flags: {} };
        messageConfig.data.flags[MODULE_SHORT] = { quickRoll: true };
        messageConfig.flags[MODULE_SHORT]      = { quickRoll: true };

        return activity.rollFormula(config, dialogConfig, messageConfig);
    }
}

/**
 * Merge a set of new rolls into an existing roll array, first removing any rolls of the
 * same class so that re-rolls replace rather than duplicate the previous result.
 *
 * @param {Roll[]|object[]} existingRolls  Current serialised or live roll array.
 * @param {Roll[]}          newRolls       Fresh rolls to inject.
 * @param {typeof Roll}     cleanType      Roll class whose existing entries to evict.
 * @returns {Roll[]}
 */
function _injectRollsToArray(existingRolls, newRolls, cleanType) {
    if (!CoreUtility.isIterable(newRolls)) {
        return existingRolls;
    }

    let processedRolls = Array.from(existingRolls);

    if (cleanType) {
        processedRolls = processedRolls.filter(r => {
            const isTargetType = r instanceof cleanType || r.class === cleanType.name;
            return !isTargetType;
        });
    }

    processedRolls.push(...newRolls);
    return processedRolls;
}
