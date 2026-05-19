import {ObjectValidator} from "../validator/ObjectValidator";
import {ModelId} from "./models";
import {NumberValidator} from "../validator/NumberValidator";

export class ModelIdValidator extends ObjectValidator<ModelId> {
    constructor() {
        super();
        this.add("id", new NumberValidator());
    }
}
